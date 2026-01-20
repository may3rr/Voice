/**
 * 音频处理工具
 *
 * 提供音频格式转换、PCM 处理等工具函数
 * 用于将浏览器录音数据转换为 ASR 所需的格式
 */

/**
 * 音频格式配置
 */
export interface AudioFormat {
  /** 采样率 */
  sampleRate: number;
  /** 位深 */
  bitDepth: number;
  /** 声道数 */
  channels: number;
}

/**
 * 默认音频格式（豆包 ASR 要求）
 */
export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 16000,
  bitDepth: 16,
  channels: 1,
};

/**
 * 将 Float32Array（Web Audio API 输出）转换为 Int16Array（PCM 16bit）
 *
 * Web Audio API 输出的是 -1.0 到 1.0 的浮点数
 * PCM 16bit 需要 -32768 到 32767 的整数
 *
 * @param float32Array - 浮点音频数据
 * @returns Int16Array PCM 数据
 *
 * @example
 * ```typescript
 * // 在 AudioWorklet 或 ScriptProcessorNode 中
 * const float32Data = inputBuffer.getChannelData(0);
 * const pcmData = float32ToInt16(float32Data);
 * ```
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
    // 限制在 -1 到 1 范围内
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    // 转换为 16bit 整数
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return int16Array;
}

/**
 * 将 Int16Array 转换为 Float32Array
 *
 * @param int16Array - Int16 PCM 数据
 * @returns Float32Array 浮点音频数据 (-1 到 1 范围)
 */
export function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);

  for (let i = 0; i < int16Array.length; i++) {
    // 转换为 -1 到 1 范围的浮点数
    float32Array[i] = int16Array[i] < 0 
      ? int16Array[i] / 0x8000 
      : int16Array[i] / 0x7fff;
  }

  return float32Array;
}

/**
 * 将 Int16Array 转换为 Uint8Array（用于网络传输）
 *
 * @param int16Array - Int16 PCM 数据
 * @returns Uint8Array 字节数据
 */
export function int16ToUint8(int16Array: Int16Array): Uint8Array {
  return new Uint8Array(int16Array.buffer);
}

/**
 * 将 Float32Array 直接转换为 Uint8Array（PCM 16bit 字节流）
 *
 * 这是 float32ToInt16 和 int16ToUint8 的组合
 *
 * @param float32Array - 浮点音频数据
 * @returns Uint8Array PCM 字节数据
 */
export function float32ToPCMBytes(float32Array: Float32Array): Uint8Array {
  const int16Array = float32ToInt16(float32Array);
  return int16ToUint8(int16Array);
}

/**
 * 合并多个 Uint8Array
 *
 * @param arrays - 要合并的数组
 * @returns 合并后的数组
 */
export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * 重采样音频数据
 *
 * 使用简单的线性插值进行重采样
 * 注意：此方法适用于简单场景，高质量重采样应使用专业库
 *
 * @param inputData - 输入音频数据
 * @param inputSampleRate - 输入采样率
 * @param outputSampleRate - 输出采样率
 * @returns 重采样后的数据
 */
export function resample(
  inputData: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return inputData;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputData.length / ratio);
  const outputData = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    // 线性插值
    outputData[i] =
      inputData[srcIndexFloor] * (1 - fraction) +
      inputData[srcIndexCeil] * fraction;
  }

  return outputData;
}

/**
 * 将立体声转换为单声道
 *
 * @param leftChannel - 左声道数据
 * @param rightChannel - 右声道数据
 * @returns 单声道数据
 */
export function stereoToMono(
  leftChannel: Float32Array,
  rightChannel: Float32Array
): Float32Array {
  const monoData = new Float32Array(leftChannel.length);

  for (let i = 0; i < leftChannel.length; i++) {
    monoData[i] = (leftChannel[i] + rightChannel[i]) / 2;
  }

  return monoData;
}

/**
 * 计算音频数据的 RMS（均方根）音量
 *
 * @param data - 音频数据
 * @returns RMS 值（0 到 1）
 */
export function calculateRMS(data: Float32Array): number {
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }

  return Math.sqrt(sum / data.length);
}

/**
 * 计算音频数据的峰值音量
 *
 * @param data - 音频数据
 * @returns 峰值（0 到 1）
 */
export function calculatePeak(data: Float32Array): number {
  let peak = 0;

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) {
      peak = abs;
    }
  }

  return peak;
}

/**
 * 将分贝值转换为线性值
 *
 * @param db - 分贝值
 * @returns 线性值
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * 将线性值转换为分贝值
 *
 * @param linear - 线性值
 * @returns 分贝值
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) {
    return -Infinity;
  }
  return 20 * Math.log10(linear);
}

/**
 * 音频缓冲区类
 *
 * 用于管理音频数据的累积和切片
 */
export class AudioBuffer {
  private buffers: Uint8Array[] = [];
  private totalLength = 0;

  /**
   * 添加数据到缓冲区
   *
   * @param data - 音频数据
   */
  push(data: Uint8Array): void {
    this.buffers.push(data);
    this.totalLength += data.length;
  }

  /**
   * 获取并清空缓冲区
   *
   * @returns 合并后的数据
   */
  flush(): Uint8Array {
    if (this.buffers.length === 0) {
      return new Uint8Array(0);
    }

    const result = concatUint8Arrays(...this.buffers);
    this.clear();
    return result;
  }

  /**
   * 获取指定长度的数据（不清空）
   *
   * @param length - 要获取的字节数
   * @returns 数据切片
   */
  peek(length: number): Uint8Array {
    const merged = concatUint8Arrays(...this.buffers);
    return merged.slice(0, Math.min(length, merged.length));
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.buffers = [];
    this.totalLength = 0;
  }

  /**
   * 获取当前缓冲区长度
   */
  get length(): number {
    return this.totalLength;
  }

  /**
   * 缓冲区是否为空
   */
  get isEmpty(): boolean {
    return this.totalLength === 0;
  }
}
