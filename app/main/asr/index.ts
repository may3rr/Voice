/**
 * ASR 模块导出
 */

export { ASRClient, type TranscriptionCallback, type ConnectionState } from "./asr-client";
export {
  ASRManager,
  type ASRManagerConfig,
  type TranscriptionHistoryEntry,
} from "./asr-manager";
export {
  // 音频格式转换
  float32ToInt16,
  int16ToUint8,
  float32ToPCMBytes,
  concatUint8Arrays,
  resample,
  stereoToMono,
  // 音量计算
  calculateRMS,
  calculatePeak,
  dbToLinear,
  linearToDb,
  // 音频缓冲区
  AudioBuffer,
  // 类型和常量
  type AudioFormat,
  DEFAULT_AUDIO_FORMAT,
} from "./audio-processor";
