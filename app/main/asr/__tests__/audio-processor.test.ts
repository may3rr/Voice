/**
 * 音频处理工具单元测试
 */

import { describe, it, expect } from "vitest";
import {
  float32ToInt16,
  int16ToUint8,
  float32ToPCMBytes,
  concatUint8Arrays,
  resample,
  stereoToMono,
  calculateRMS,
  calculatePeak,
  dbToLinear,
  linearToDb,
  AudioBuffer,
} from "../audio-processor";

describe("float32ToInt16", () => {
  it("should convert 0.0 to 0", () => {
    const input = new Float32Array([0.0]);
    const result = float32ToInt16(input);
    expect(result[0]).toBe(0);
  });

  it("should convert 1.0 to 32767 (max positive)", () => {
    const input = new Float32Array([1.0]);
    const result = float32ToInt16(input);
    expect(result[0]).toBe(32767);
  });

  it("should convert -1.0 to -32768 (max negative)", () => {
    const input = new Float32Array([-1.0]);
    const result = float32ToInt16(input);
    expect(result[0]).toBe(-32768);
  });

  it("should clamp values above 1.0", () => {
    const input = new Float32Array([1.5]);
    const result = float32ToInt16(input);
    expect(result[0]).toBe(32767);
  });

  it("should clamp values below -1.0", () => {
    const input = new Float32Array([-1.5]);
    const result = float32ToInt16(input);
    expect(result[0]).toBe(-32768);
  });

  it("should convert 0.5 to approximately 16383", () => {
    const input = new Float32Array([0.5]);
    const result = float32ToInt16(input);
    expect(result[0]).toBeCloseTo(16383, -1);
  });

  it("should handle arrays with multiple values", () => {
    const input = new Float32Array([0.0, 0.5, 1.0, -0.5, -1.0]);
    const result = float32ToInt16(input);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(32767);
    expect(result[4]).toBe(-32768);
  });
});

describe("int16ToUint8", () => {
  it("should convert Int16Array to Uint8Array with correct byte order", () => {
    const input = new Int16Array([0x0102]);
    const result = int16ToUint8(input);
    expect(result.length).toBe(2);
    // Little-endian byte order
    expect(result[0]).toBe(0x02);
    expect(result[1]).toBe(0x01);
  });

  it("should double the length", () => {
    const input = new Int16Array([1, 2, 3]);
    const result = int16ToUint8(input);
    expect(result.length).toBe(6);
  });
});

describe("float32ToPCMBytes", () => {
  it("should combine float32ToInt16 and int16ToUint8", () => {
    const input = new Float32Array([0.0, 1.0, -1.0]);
    const result = float32ToPCMBytes(input);
    expect(result.length).toBe(6); // 3 samples * 2 bytes
  });
});

describe("concatUint8Arrays", () => {
  it("should concatenate multiple arrays", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    const result = concatUint8Arrays(a, b, c);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("should handle empty arrays", () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([]);
    const c = new Uint8Array([2]);
    const result = concatUint8Arrays(a, b, c);
    expect(result).toEqual(new Uint8Array([1, 2]));
  });

  it("should return empty array when no inputs", () => {
    const result = concatUint8Arrays();
    expect(result.length).toBe(0);
  });
});

describe("resample", () => {
  it("should return same data when sample rates are equal", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const result = resample(input, 44100, 44100);
    expect(result).toEqual(input);
  });

  it("should downsample from 44100 to 16000", () => {
    const input = new Float32Array(4410); // 100ms at 44100Hz
    input.fill(0.5);
    const result = resample(input, 44100, 16000);
    // Expected length: 4410 * (16000/44100) ≈ 1600
    expect(result.length).toBeCloseTo(1600, -1);
  });

  it("should upsample from 16000 to 44100", () => {
    const input = new Float32Array(1600); // 100ms at 16000Hz
    input.fill(0.5);
    const result = resample(input, 16000, 44100);
    // Expected length: 1600 * (44100/16000) ≈ 4410
    expect(result.length).toBeCloseTo(4410, -1);
  });
});

describe("stereoToMono", () => {
  it("should average left and right channels", () => {
    const left = new Float32Array([0.2, 0.4, 0.6]);
    const right = new Float32Array([0.4, 0.6, 0.8]);
    const result = stereoToMono(left, right);
    expect(result[0]).toBeCloseTo(0.3);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.7);
  });

  it("should handle silence", () => {
    const left = new Float32Array([0, 0, 0]);
    const right = new Float32Array([0, 0, 0]);
    const result = stereoToMono(left, right);
    expect(result).toEqual(new Float32Array([0, 0, 0]));
  });
});

describe("calculateRMS", () => {
  it("should return 0 for silence", () => {
    const input = new Float32Array([0, 0, 0, 0]);
    expect(calculateRMS(input)).toBe(0);
  });

  it("should return correct RMS for constant signal", () => {
    const input = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(calculateRMS(input)).toBe(0.5);
  });

  it("should handle sine-like values", () => {
    // Simple sine: [0, 1, 0, -1]
    const input = new Float32Array([0, 1, 0, -1]);
    // RMS = sqrt((0 + 1 + 0 + 1) / 4) = sqrt(0.5) ≈ 0.707
    expect(calculateRMS(input)).toBeCloseTo(0.707, 2);
  });
});

describe("calculatePeak", () => {
  it("should return 0 for silence", () => {
    const input = new Float32Array([0, 0, 0, 0]);
    expect(calculatePeak(input)).toBe(0);
  });

  it("should find positive peak", () => {
    const input = new Float32Array([0.1, 0.5, 0.3, 0.2]);
    expect(calculatePeak(input)).toBe(0.5);
  });

  it("should find negative peak", () => {
    const input = new Float32Array([0.1, -0.8, 0.3, 0.2]);
    const peak = calculatePeak(input);
    expect(peak).toBeCloseTo(0.8, 1); // 1 位小数精度
  });
});

describe("dbToLinear / linearToDb", () => {
  it("should convert 0 dB to 1.0", () => {
    expect(dbToLinear(0)).toBe(1);
  });

  it("should convert -6 dB to approximately 0.5", () => {
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
  });

  it("should convert -20 dB to 0.1", () => {
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 2);
  });

  it("should convert 1.0 to 0 dB", () => {
    expect(linearToDb(1)).toBe(0);
  });

  it("should convert 0.1 to -20 dB", () => {
    expect(linearToDb(0.1)).toBeCloseTo(-20, 1);
  });

  it("should return -Infinity for 0", () => {
    expect(linearToDb(0)).toBe(-Infinity);
  });

  it("should be reversible", () => {
    const original = 0.5;
    const db = linearToDb(original);
    const back = dbToLinear(db);
    expect(back).toBeCloseTo(original, 5);
  });
});

describe("AudioBuffer", () => {
  it("should start empty", () => {
    const buffer = new AudioBuffer();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.length).toBe(0);
  });

  it("should accumulate data", () => {
    const buffer = new AudioBuffer();
    buffer.push(new Uint8Array([1, 2]));
    buffer.push(new Uint8Array([3, 4, 5]));
    expect(buffer.length).toBe(5);
    expect(buffer.isEmpty).toBe(false);
  });

  it("should flush and clear", () => {
    const buffer = new AudioBuffer();
    buffer.push(new Uint8Array([1, 2]));
    buffer.push(new Uint8Array([3, 4]));
    const result = buffer.flush();
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(buffer.isEmpty).toBe(true);
  });

  it("should peek without clearing", () => {
    const buffer = new AudioBuffer();
    buffer.push(new Uint8Array([1, 2, 3, 4, 5]));
    const peeked = buffer.peek(3);
    expect(peeked).toEqual(new Uint8Array([1, 2, 3]));
    expect(buffer.length).toBe(5); // unchanged
  });

  it("should clear", () => {
    const buffer = new AudioBuffer();
    buffer.push(new Uint8Array([1, 2, 3]));
    buffer.clear();
    expect(buffer.isEmpty).toBe(true);
  });
});
