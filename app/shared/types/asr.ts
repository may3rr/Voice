/**
 * ASR 模块共享类型定义
 *
 * 用于主进程、预加载脚本、渲染进程之间的类型共享
 */

/**
 * ASR 会话状态
 */
export type ASRState =
  | "idle" // 空闲，未连接
  | "connecting" // 正在连接 WebSocket
  | "ready" // 已连接，等待音频
  | "recording" // 正在录音和转写
  | "processing" // 发送最后一包，等待最终结果
  | "completed" // 转写完成
  | "error"; // 发生错误

/**
 * 单个语句（utterance）信息
 */
export interface ASRUtterance {
  /** 语句文本 */
  text: string;
  /** 开始时间（毫秒） */
  startTime: number;
  /** 结束时间（毫秒） */
  endTime: number;
  /** 是否为最终结果（非 partial） */
  definite: boolean;
}

/**
 * ASR 转写结果
 */
export interface ASRResult {
  /** 转写文本 */
  text: string;
  /** 是否为部分结果（实时识别中） */
  isPartial: boolean;
  /** 语句列表（可选） */
  utterances?: ASRUtterance[];
  /** 错误信息（可选） */
  error?: string;
}

/**
 * ASR 配置选项
 */
export interface ASRConfig {
  /** 豆包 App Key */
  appKey: string;
  /** 豆包 Access Key */
  accessKey: string;
  /** 音频格式配置 */
  audio?: {
    /** 采样率，默认 16000 */
    sampleRate?: number;
    /** 位深，默认 16 */
    bitDepth?: number;
    /** 声道数，默认 1 */
    channels?: number;
  };
  /** ASR 请求配置 */
  request?: {
    /** 模型名称，默认 bigmodel */
    modelName?: string;
    /** 是否启用 ITN（逆文本正则化），默认 true */
    enableITN?: boolean;
    /** 是否启用标点，默认 true */
    enablePunc?: boolean;
    /** 是否启用顺滑（去语气词），默认 true */
    enableDDC?: boolean;
    /** 是否返回 utterances，默认 true */
    showUtterances?: boolean;
  };
}

/**
 * ASR 事件类型
 */
export type ASREventType =
  | "state-change" // 状态变更
  | "result" // 收到转写结果
  | "error" // 发生错误
  | "connected" // WebSocket 已连接
  | "disconnected"; // WebSocket 已断开

/**
 * ASR 事件数据
 */
export interface ASREvent {
  type: ASREventType;
  /** 当前状态 */
  state?: ASRState;
  /** 转写结果 */
  result?: ASRResult;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * ASR 事件回调函数类型
 */
export type ASREventCallback = (event: ASREvent) => void;

/**
 * 润色配置
 */
export interface RewriteConfig {
  /** API 地址 */
  apiUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 温度参数，默认 0.3 */
  temperature?: number;
  /** 最大 token 数，默认 4096 */
  maxTokens?: number;
}

/**
 * 润色结果
 */
export interface RewriteResult {
  /** 原始文本 */
  original: string;
  /** 润色后文本 */
  polished: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * IPC 通道名称常量
 */
export const IPC_CHANNELS = {
  // Renderer -> Main
  ASR_START: "asr:start",
  ASR_STOP: "asr:stop",
  ASR_SEND_AUDIO: "asr:send-audio",
  REWRITE_TEXT: "rewrite:text",

  // Main -> Renderer
  ASR_STATE_CHANGE: "asr:state-change",
  ASR_RESULT: "asr:result",
  ASR_ERROR: "asr:error",
  REWRITE_RESULT: "rewrite:result",
} as const;

/**
 * 默认 ASR 配置
 */
export const DEFAULT_ASR_CONFIG: Required<
  Pick<ASRConfig, "audio" | "request">
> = {
  audio: {
    sampleRate: 16000,
    bitDepth: 16,
    channels: 1,
  },
  request: {
    modelName: "bigmodel",
    enableITN: true,
    enablePunc: true,
    enableDDC: true,
    showUtterances: true,
  },
};
