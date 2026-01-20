/**
 * ASR 会话管理器
 *
 * 提供高层 API 管理 ASR 会话生命周期
 * 支持事件订阅、状态管理、结果缓存
 */

import { EventEmitter } from "events";
import { ASRClient, type TranscriptionCallback } from "./asr-client";
import type {
  ASRConfig,
  ASRState,
  ASRResult,
  ASREvent,
  ASREventCallback,
  ASREventType,
} from "../../shared";

/**
 * ASR 会话管理器配置
 */
export interface ASRManagerConfig extends ASRConfig {
  /** 是否自动保存历史记录，默认 true */
  autoSaveHistory?: boolean;
  /** 最大历史记录数量，默认 100 */
  maxHistorySize?: number;
}

/**
 * 转写历史记录条目
 */
export interface TranscriptionHistoryEntry {
  /** 唯一 ID */
  id: string;
  /** 最终转写文本 */
  text: string;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime: Date;
  /** 时长（毫秒） */
  duration: number;
}

/**
 * ASR 会话管理器
 *
 * 封装 ASRClient，提供更友好的 API
 *
 * @example
 * ```typescript
 * const manager = new ASRManager({
 *   appKey: 'your-app-key',
 *   accessKey: 'your-access-key'
 * });
 *
 * manager.on('result', (event) => {
 *   console.log('转写结果:', event.result?.text);
 * });
 *
 * await manager.startSession();
 * // ... 发送音频数据 ...
 * const result = await manager.stopSession();
 * console.log('最终结果:', result.text);
 * ```
 */
export class ASRManager extends EventEmitter {
  private config: ASRManagerConfig;
  private client: ASRClient | null = null;
  private currentState: ASRState = "idle";
  private sessionStartTime: Date | null = null;
  private partialResults: ASRResult[] = [];
  private finalResult: ASRResult | null = null;
  private history: TranscriptionHistoryEntry[] = [];

  /**
   * 创建 ASR 管理器实例
   *
   * @param config - 管理器配置
   */
  constructor(config: ASRManagerConfig) {
    super();
    this.config = {
      ...config,
      autoSaveHistory: config.autoSaveHistory ?? true,
      maxHistorySize: config.maxHistorySize ?? 100,
    };
  }

  /**
   * 获取当前状态
   */
  get state(): ASRState {
    return this.currentState;
  }

  /**
   * 获取转写历史记录
   */
  get transcriptionHistory(): readonly TranscriptionHistoryEntry[] {
    return this.history;
  }

  /**
   * 获取当前会话的部分结果
   */
  get currentPartialResults(): readonly ASRResult[] {
    return this.partialResults;
  }

  /**
   * 获取当前会话的最终结果
   */
  get currentFinalResult(): ASRResult | null {
    return this.finalResult;
  }

  /**
   * 订阅事件
   *
   * @param event - 事件类型
   * @param callback - 回调函数
   */
  on(event: ASREventType, callback: ASREventCallback): this {
    return super.on(event, callback);
  }

  /**
   * 取消订阅事件
   *
   * @param event - 事件类型
   * @param callback - 回调函数
   */
  off(event: ASREventType, callback: ASREventCallback): this {
    return super.off(event, callback);
  }

  /**
   * 开始 ASR 会话
   *
   * @throws 如果已有会话在进行中
   */
  async startSession(): Promise<void> {
    if (this.currentState !== "idle") {
      throw new Error(`无法开始会话：当前状态为 ${this.currentState}`);
    }

    this.setState("connecting");
    this.sessionStartTime = new Date();
    this.partialResults = [];
    this.finalResult = null;

    const callback: TranscriptionCallback = (result) => {
      this.handleTranscriptionResult(result);
    };

    this.client = new ASRClient(this.config, callback);

    try {
      await this.client.connect();
      this.setState("ready");
      this.emitEvent("connected");
    } catch (error) {
      this.setState("error");
      this.emitEvent("error", undefined, (error as Error).message);
      throw error;
    }
  }

  /**
   * 发送音频数据
   *
   * @param audioData - PCM 音频数据
   */
  async sendAudio(audioData: Uint8Array): Promise<void> {
    if (!this.client) {
      throw new Error("会话未开始");
    }

    if (this.currentState === "ready") {
      this.setState("recording");
    }

    if (this.currentState !== "recording") {
      console.warn(`[ASRManager] 当前状态 ${this.currentState}，忽略音频数据`);
      return;
    }

    await this.client.sendAudio(audioData);
  }

  /**
   * 停止会话并获取最终结果
   *
   * @returns 最终转写结果
   */
  async stopSession(): Promise<ASRResult> {
    if (!this.client) {
      throw new Error("会话未开始");
    }

    if (
      this.currentState !== "recording" &&
      this.currentState !== "ready"
    ) {
      throw new Error(`无法停止会话：当前状态为 ${this.currentState}`);
    }

    this.setState("processing");

    try {
      await this.client.finish();

      // 等待最终结果（最多等待 5 秒）
      const result = await this.waitForFinalResult(5000);

      this.setState("completed");

      // 保存到历史记录
      if (this.config.autoSaveHistory && result.text) {
        this.addToHistory(result);
      }

      return result;
    } catch (error) {
      this.setState("error");
      this.emitEvent("error", undefined, (error as Error).message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * 取消当前会话
   */
  async cancelSession(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    this.cleanup();
    this.setState("idle");
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 获取指定历史记录
   *
   * @param id - 历史记录 ID
   */
  getHistoryEntry(id: string): TranscriptionHistoryEntry | undefined {
    return this.history.find((entry) => entry.id === id);
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 设置状态并发出事件
   */
  private setState(state: ASRState): void {
    const previousState = this.currentState;
    this.currentState = state;

    if (previousState !== state) {
      this.emitEvent("state-change");
      console.log(`[ASRManager] 状态变更: ${previousState} -> ${state}`);
    }
  }

  /**
   * 发出事件
   */
  private emitEvent(
    type: ASREventType,
    result?: ASRResult,
    error?: string
  ): void {
    const event: ASREvent = {
      type,
      state: this.currentState,
      result,
      error,
      timestamp: Date.now(),
    };
    this.emit(type, event);
  }

  /**
   * 处理转写结果
   */
  private handleTranscriptionResult(result: ASRResult): void {
    if (result.error) {
      this.emitEvent("error", result, result.error);
      return;
    }

    if (result.isPartial) {
      this.partialResults.push(result);
    } else {
      this.finalResult = result;
    }

    this.emitEvent("result", result);
  }

  /**
   * 等待最终结果
   */
  private async waitForFinalResult(timeoutMs: number): Promise<ASRResult> {
    const startTime = Date.now();

    while (!this.finalResult) {
      if (Date.now() - startTime > timeoutMs) {
        // 超时，使用最后一个部分结果
        const lastPartial = this.partialResults[this.partialResults.length - 1];
        if (lastPartial) {
          console.warn("[ASRManager] 等待最终结果超时，使用最后的部分结果");
          return { ...lastPartial, isPartial: false };
        }
        throw new Error("等待最终结果超时");
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.finalResult;
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(result: ASRResult): void {
    const endTime = new Date();
    const entry: TranscriptionHistoryEntry = {
      id: crypto.randomUUID(),
      text: result.text,
      startTime: this.sessionStartTime!,
      endTime,
      duration: endTime.getTime() - this.sessionStartTime!.getTime(),
    };

    this.history.unshift(entry);

    // 限制历史记录数量
    if (this.history.length > this.config.maxHistorySize!) {
      this.history = this.history.slice(0, this.config.maxHistorySize);
    }
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.sessionStartTime = null;
  }
}
