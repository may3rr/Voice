/**
 * ASR 管理器单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ASRManager } from "../asr-manager";
import type { ASREvent, ASRResult } from "../../../shared";

// Mock ASRClient
vi.mock("../asr-client", () => {
  return {
    ASRClient: vi.fn().mockImplementation((config, callback) => {
      return new MockASRClient(config, callback);
    }),
  };
});

class MockASRClient {
  private callback: (result: ASRResult) => void;
  private _isConnected = false;

  constructor(config: any, callback: (result: ASRResult) => void) {
    this.callback = callback;
  }

  get isConnected() {
    return this._isConnected;
  }

  async connect() {
    this._isConnected = true;
    return Promise.resolve();
  }

  async sendAudio(data: Uint8Array) {
    return Promise.resolve();
  }

  async finish() {
    // 模拟发送最终结果
    setTimeout(() => {
      this.callback({
        text: "模拟转写结果",
        isPartial: false,
      });
    }, 50);
    return Promise.resolve();
  }

  async close() {
    this._isConnected = false;
    return Promise.resolve();
  }

  // 用于测试的辅助方法
  simulatePartialResult(text: string) {
    this.callback({
      text,
      isPartial: true,
    });
  }

  simulateFinalResult(text: string) {
    this.callback({
      text,
      isPartial: false,
    });
  }

  simulateError(error: string) {
    this.callback({
      text: "",
      isPartial: true,
      error,
    });
  }
}

describe("ASRManager", () => {
  let manager: ASRManager;

  beforeEach(() => {
    manager = new ASRManager({
      appKey: "test-app-key",
      accessKey: "test-access-key",
    });
  });

  afterEach(async () => {
    await manager.cancelSession();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with idle state", () => {
      expect(manager.state).toBe("idle");
    });

    it("should have empty history", () => {
      expect(manager.transcriptionHistory).toHaveLength(0);
    });
  });

  describe("startSession", () => {
    it("should transition to ready state after connecting", async () => {
      const stateChanges: string[] = [];
      manager.on("state-change", (event: ASREvent) => {
        stateChanges.push(event.state!);
      });

      await manager.startSession();

      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("ready");
      expect(manager.state).toBe("ready");
    });

    it("should emit connected event", async () => {
      const connectedHandler = vi.fn();
      manager.on("connected", connectedHandler);

      await manager.startSession();

      expect(connectedHandler).toHaveBeenCalled();
    });

    it("should reject if already in session", async () => {
      await manager.startSession();
      await expect(manager.startSession()).rejects.toThrow("无法开始会话");
    });
  });

  describe("sendAudio", () => {
    it("should transition to recording state on first audio", async () => {
      await manager.startSession();
      expect(manager.state).toBe("ready");

      await manager.sendAudio(new Uint8Array([1, 2, 3]));
      expect(manager.state).toBe("recording");
    });

    it("should reject if session not started", async () => {
      await expect(manager.sendAudio(new Uint8Array([1]))).rejects.toThrow(
        "会话未开始"
      );
    });
  });

  describe("stopSession", () => {
    it("should return final result", async () => {
      await manager.startSession();
      await manager.sendAudio(new Uint8Array([1, 2, 3]));

      const result = await manager.stopSession();

      expect(result.text).toBe("模拟转写结果");
      expect(result.isPartial).toBe(false);
      expect(manager.state).toBe("completed");
    });

    it("should save to history when autoSaveHistory is true", async () => {
      await manager.startSession();
      await manager.sendAudio(new Uint8Array([1, 2, 3]));
      await manager.stopSession();

      expect(manager.transcriptionHistory).toHaveLength(1);
      expect(manager.transcriptionHistory[0].text).toBe("模拟转写结果");
    });

    it("should not save to history when autoSaveHistory is false", async () => {
      const noHistoryManager = new ASRManager({
        appKey: "test",
        accessKey: "test",
        autoSaveHistory: false,
      });

      await noHistoryManager.startSession();
      await noHistoryManager.sendAudio(new Uint8Array([1, 2, 3]));
      await noHistoryManager.stopSession();

      expect(noHistoryManager.transcriptionHistory).toHaveLength(0);
    });
  });

  describe("cancelSession", () => {
    it("should reset to idle state", async () => {
      await manager.startSession();
      await manager.cancelSession();

      expect(manager.state).toBe("idle");
    });
  });

  describe("event handling", () => {
    it("should emit result events", async () => {
      const resultHandler = vi.fn();
      manager.on("result", resultHandler);

      await manager.startSession();
      await manager.sendAudio(new Uint8Array([1, 2, 3]));
      await manager.stopSession();

      expect(resultHandler).toHaveBeenCalled();
    });
  });

  describe("history management", () => {
    it("should limit history size", async () => {
      const smallHistoryManager = new ASRManager({
        appKey: "test",
        accessKey: "test",
        maxHistorySize: 2,
      });

      // 添加 3 个记录
      for (let i = 0; i < 3; i++) {
        await smallHistoryManager.startSession();
        await smallHistoryManager.sendAudio(new Uint8Array([1]));
        await smallHistoryManager.stopSession();
        // 等待以确保前一个会话完全结束，并重置状态到 idle
        await new Promise(resolve => setTimeout(resolve, 150));
        // 手动重置状态以便下次会话
        await smallHistoryManager.cancelSession();
      }

      // 由于 maxHistorySize 为 2，应该只保留最后 2 条记录
      expect(smallHistoryManager.transcriptionHistory.length).toBeLessThanOrEqual(2);
    });

    it("should clear history", async () => {
      await manager.startSession();
      await manager.sendAudio(new Uint8Array([1]));
      await manager.stopSession();

      expect(manager.transcriptionHistory).toHaveLength(1);

      manager.clearHistory();
      expect(manager.transcriptionHistory).toHaveLength(0);
    });

    it("should get history entry by id", async () => {
      await manager.startSession();
      await manager.sendAudio(new Uint8Array([1]));
      await manager.stopSession();

      const firstEntry = manager.transcriptionHistory[0];
      const retrieved = manager.getHistoryEntry(firstEntry.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(firstEntry.id);
    });
  });
});
