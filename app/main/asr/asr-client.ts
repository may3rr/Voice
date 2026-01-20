/**
 * 字节跳动豆包流式语音识别 WebSocket 客户端
 *
 * 适配 Bun / Electron 主进程环境
 * 实现二进制协议与豆包 ASR 服务通信
 */

import * as zlib from "zlib";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type { ASRResult, ASRConfig, DEFAULT_ASR_CONFIG } from "../../shared";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ============================================================================
// 协议常量
// ============================================================================

const ProtocolVersion = {
  V1: 0b0001,
} as const;

const MessageType = {
  CLIENT_FULL_REQUEST: 0b0001,
  CLIENT_AUDIO_ONLY_REQUEST: 0b0010,
  SERVER_FULL_RESPONSE: 0b1001,
  SERVER_ERROR_RESPONSE: 0b1111,
} as const;

const MessageTypeSpecificFlags = {
  NO_SEQUENCE: 0b0000,
  POS_SEQUENCE: 0b0001,
  NEG_SEQUENCE: 0b0010,
  NEG_WITH_SEQUENCE: 0b0011,
} as const;

const SerializationType = {
  NO_SERIALIZATION: 0b0000,
  JSON: 0b0001,
} as const;

const CompressionType = {
  NO_COMPRESSION: 0b0000,
  GZIP: 0b0001,
} as const;

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 转写回调类型
 */
export type TranscriptionCallback = (result: ASRResult) => void;

/**
 * 连接状态
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "closing";

// ============================================================================
// ASR WebSocket 客户端类
// ============================================================================

/**
 * ASR WebSocket 客户端
 *
 * 用于与豆包 ASR 服务进行流式通信
 *
 * @example
 * ```typescript
 * const client = new ASRClient({
 *   appKey: 'your-app-key',
 *   accessKey: 'your-access-key'
 * }, (result) => {
 *   console.log('转写结果:', result.text);
 * });
 *
 * await client.connect();
 * await client.sendAudio(pcmData);
 * await client.finish();
 * ```
 */
export class ASRClient {
  private config: Required<ASRConfig>;
  private callback: TranscriptionCallback;
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private audioBuffer: Uint8Array[] = [];
  private sendInterval: ReturnType<typeof setInterval> | null = null;

  /** 豆包双向流式 ASR 服务端点 */
  private readonly ASR_URL =
    "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

  /** 音频发送间隔（毫秒） */
  private readonly SEND_INTERVAL_MS = 200;

  /**
   * 创建 ASR 客户端实例
   *
   * @param config - ASR 配置
   * @param callback - 转写结果回调函数
   */
  constructor(config: ASRConfig, callback: TranscriptionCallback) {
    // 合并默认配置
    this.config = {
      appKey: config.appKey,
      accessKey: config.accessKey,
      audio: {
        sampleRate: config.audio?.sampleRate ?? 16000,
        bitDepth: config.audio?.bitDepth ?? 16,
        channels: config.audio?.channels ?? 1,
      },
      request: {
        modelName: config.request?.modelName ?? "bigmodel",
        enableITN: config.request?.enableITN ?? true,
        enablePunc: config.request?.enablePunc ?? true,
        enableDDC: config.request?.enableDDC ?? true,
        showUtterances: config.request?.showUtterances ?? true,
      },
    };
    this.callback = callback;
  }

  /**
   * 获取当前连接状态
   */
  get state(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 是否已连接
   */
  get isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * 连接到 ASR 服务
   *
   * @returns Promise，连接成功时 resolve
   * @throws 连接失败时 reject
   */
  async connect(): Promise<void> {
    if (this.connectionState !== "disconnected") {
      throw new Error(`无法连接：当前状态为 ${this.connectionState}`);
    }

    this.connectionState = "connecting";
    const requestId = randomUUID();

    return new Promise((resolve, reject) => {
      try {
        // Bun 原生 WebSocket 支持 headers 选项
        this.ws = new WebSocket(this.ASR_URL, {
          headers: {
            "X-Api-Resource-Id": "volc.seedasr.sauc.duration",
            "X-Api-Request-Id": requestId,
            "X-Api-Connect-Id": requestId,
            "X-Api-Access-Key": this.config.accessKey,
            "X-Api-App-Key": this.config.appKey,
          },
        } as any);

        this.ws.binaryType = "arraybuffer";

        this.ws.addEventListener("open", async () => {
          console.log("[ASRClient] WebSocket 已连接");
          this.connectionState = "connected";

          try {
            await this.sendFullClientRequest();
            this.startAudioSender();
            resolve();
          } catch (error) {
            this.connectionState = "disconnected";
            reject(error);
          }
        });

        this.ws.addEventListener("message", async (event) => {
          try {
            const data = event.data;
            if (data instanceof ArrayBuffer) {
              await this.handleResponse(new Uint8Array(data));
            }
          } catch (error) {
            console.error("[ASRClient] 处理响应错误:", error);
          }
        });

        this.ws.addEventListener("error", (event) => {
          console.error("[ASRClient] WebSocket 错误:", event);
          this.callback({
            text: "",
            isPartial: true,
            error: `连接错误: ${event}`,
          });

          if (this.connectionState === "connecting") {
            this.connectionState = "disconnected";
            reject(new Error("WebSocket 连接失败"));
          }
        });

        this.ws.addEventListener("close", (event) => {
          console.log(
            `[ASRClient] WebSocket 已关闭 (code=${event.code}, reason=${event.reason})`
          );
          this.connectionState = "disconnected";
          this.stopAudioSender();
        });
      } catch (error) {
        this.connectionState = "disconnected";
        reject(error);
      }
    });
  }

  /**
   * 发送音频数据
   *
   * 音频数据会被缓存，定时批量发送
   *
   * @param audioData - PCM 音频数据（16bit, 16kHz, 单声道）
   */
  async sendAudio(audioData: Uint8Array): Promise<void> {
    if (!this.isConnected) {
      console.warn("[ASRClient] 未连接，忽略音频数据");
      return;
    }
    this.audioBuffer.push(audioData);
  }

  /**
   * 完成录音，发送最后一个数据包
   *
   * 调用此方法后，客户端会发送剩余的音频数据并标记为最后一包
   */
  async finish(): Promise<void> {
    console.log("[ASRClient] finish() 被调用");
    this.stopAudioSender();

    if (!this.isConnected) {
      console.log("[ASRClient] finish() 时未连接，跳过");
      return;
    }

    // 发送剩余的音频数据
    if (this.audioBuffer.length > 0) {
      console.log(`[ASRClient] 发送剩余音频缓冲: ${this.audioBuffer.length} 块`);
      const mergedData = this.mergeAudioBuffer();
      await this.sendAudioPacket(mergedData, true);
    } else {
      console.log("[ASRClient] 发送空的最后一包");
      // 发送空的最后一包
      await this.sendAudioPacket(new Uint8Array(0), true);
    }
    console.log("[ASRClient] finish() 完成");
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    this.stopAudioSender();

    if (this.ws) {
      this.connectionState = "closing";
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = "disconnected";
    this.audioBuffer = [];
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 构建协议头
   */
  private buildHeader(
    messageType: number,
    flags: number,
    serialization: number,
    compression: number
  ): Uint8Array {
    const header = new Uint8Array(4);
    header[0] = (ProtocolVersion.V1 << 4) | 1; // version + header size (1 = 4 bytes)
    header[1] = (messageType << 4) | flags;
    header[2] = (serialization << 4) | compression;
    header[3] = 0x00; // reserved
    return header;
  }

  /**
   * 发送完整客户端请求（初始化）
   */
  private async sendFullClientRequest(): Promise<void> {
    const payload = {
      user: {
        uid: "voice_electron_user",
      },
      audio: {
        format: "pcm",
        codec: "raw",
        rate: this.config.audio.sampleRate,
        bits: this.config.audio.bitDepth,
        channel: this.config.audio.channels,
      },
      request: {
        model_name: this.config.request.modelName,
        enable_itn: this.config.request.enableITN,
        enable_punc: this.config.request.enablePunc,
        enable_ddc: this.config.request.enableDDC,
        show_utterances: this.config.request.showUtterances,
        result_type: "full",
      },
    };

    console.log("[ASRClient] 发送初始化请求:", JSON.stringify(payload, null, 2));
    
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const compressedPayload = await gzip(payloadBytes);

    const header = this.buildHeader(
      MessageType.CLIENT_FULL_REQUEST,
      MessageTypeSpecificFlags.NO_SEQUENCE,
      SerializationType.JSON,
      CompressionType.GZIP
    );

    // Full client request 不需要序列号，直接组装
    const payloadSize = compressedPayload.length;
    const request = new Uint8Array(header.length + 4 + payloadSize);
    let offset = 0;
    request.set(header, offset);
    offset += header.length;
    new DataView(request.buffer).setUint32(offset, payloadSize, false);
    offset += 4;
    request.set(new Uint8Array(compressedPayload), offset);
    this.ws?.send(request);

    console.log("[ASRClient] 初始化请求已发送");
  }

  /**
   * 启动定时发送音频
   */
  private startAudioSender(): void {
    this.sendInterval = setInterval(async () => {
      if (this.audioBuffer.length === 0 || !this.isConnected) {
        return;
      }

      const mergedData = this.mergeAudioBuffer();
      await this.sendAudioPacket(mergedData, false);
    }, this.SEND_INTERVAL_MS);
  }

  /**
   * 停止定时发送音频
   */
  private stopAudioSender(): void {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
  }

  /**
   * 合并音频缓冲区
   */
  private mergeAudioBuffer(): Uint8Array {
    const totalLength = this.audioBuffer.reduce(
      (acc, buf) => acc + buf.length,
      0
    );
    const mergedData = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of this.audioBuffer) {
      mergedData.set(buf, offset);
      offset += buf.length;
    }
    this.audioBuffer = [];
    return mergedData;
  }

  /**
   * 发送音频数据包
   */
  private async sendAudioPacket(
    audioData: Uint8Array,
    isLast: boolean
  ): Promise<void> {
    if (!this.ws || !this.isConnected) {
      return;
    }

    const compressedAudio = await gzip(audioData);

    const flags = isLast
      ? MessageTypeSpecificFlags.NEG_SEQUENCE
      : MessageTypeSpecificFlags.NO_SEQUENCE;

    const header = this.buildHeader(
      MessageType.CLIENT_AUDIO_ONLY_REQUEST,
      flags,
      SerializationType.NO_SERIALIZATION,
      CompressionType.GZIP
    );

    const payloadSize = compressedAudio.length;
    const request = new Uint8Array(header.length + 4 + payloadSize);
    let offset = 0;
    request.set(header, offset);
    offset += header.length;
    new DataView(request.buffer).setUint32(offset, payloadSize, false);
    offset += 4;
    request.set(new Uint8Array(compressedAudio), offset);

    if (isLast) {
      console.log(
        `[ASRClient] 发送最后一包 (无序列号), 压缩后大小=${compressedAudio.length} bytes`
      );
    }

    this.ws.send(request);
  }

  /**
   * 构建请求数据包
   */
  /**
   * 处理服务器响应
   */
  private async handleResponse(data: Uint8Array): Promise<void> {
    if (data.length < 4) {
      console.error("[ASRClient] 响应数据太短");
      return;
    }

    const headerSize = (data[0] & 0x0f) * 4;
    const messageType = (data[1] >> 4) & 0x0f;
    const messageFlags = data[1] & 0x0f;
    const compressionMethod = data[2] & 0x0f;

    let payload = data.slice(headerSize);
    let isLastPackage = false;

    // 解析 flags
    if (messageFlags & 0x01) {
      // 有 sequence
      payload = payload.slice(4);
    }
    if (messageFlags & 0x02) {
      isLastPackage = true;
    }

    // 处理错误响应
    if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
      const errorCode = new DataView(
        payload.buffer,
        payload.byteOffset
      ).getInt32(0, false);
      payload = payload.slice(8);

      let errorMessage = "";
      if (compressionMethod === CompressionType.GZIP) {
        const decompressed = await gunzip(payload);
        errorMessage = new TextDecoder().decode(decompressed);
      } else {
        errorMessage = new TextDecoder().decode(payload);
      }

      console.error(`[ASRClient] 服务器错误 [${errorCode}]: ${errorMessage}`);
      this.callback({
        text: "",
        isPartial: true,
        error: `错误码 ${errorCode}: ${errorMessage}`,
      });
      return;
    }

    // 处理正常响应
    if (messageType === MessageType.SERVER_FULL_RESPONSE) {
      const payloadSize = new DataView(
        payload.buffer,
        payload.byteOffset
      ).getUint32(0, false);
      payload = payload.slice(4);

      if (payload.length === 0) {
        return;
      }

      let jsonData: any;
      if (compressionMethod === CompressionType.GZIP) {
        const decompressed = await gunzip(payload);
        jsonData = JSON.parse(new TextDecoder().decode(decompressed));
      } else {
        jsonData = JSON.parse(new TextDecoder().decode(payload));
      }

      console.log("[ASRClient] 收到响应:", JSON.stringify(jsonData, null, 2));

      // 提取转写结果
      // 豆包 ASR 返回格式：
      // - result.text: 完整识别文本
      // - result.utterances: 语句列表
      // - payload_msg.result: 或者在这个字段
      const result = jsonData.payload_msg?.result || jsonData.result;
      
      if (result) {
        // 尝试多种可能的字段路径
        const text = result.text || 
                    result.payload_msg?.result?.text ||
                    (result.utterances && result.utterances.length > 0 
                      ? result.utterances.map((u: any) => u.text).join('')
                      : "");
        
        const utterances = result.utterances?.map((u: any) => ({
          text: u.text,
          startTime: u.start_time || u.startTime,
          endTime: u.end_time || u.endTime,
          definite: u.definite,
        }));

        // 只有当有实际内容时才回调
        if (text || utterances) {
          this.callback({
            text,
            isPartial: !isLastPackage,
            utterances,
          });
        }
      }
    }
  }
}
