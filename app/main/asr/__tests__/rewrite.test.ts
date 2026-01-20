/**
 * 润色服务单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RewriteService,
  rewriteText,
  createRewriteServiceFromEnv,
} from "../../rewrite";

// 保存原始的 fetch
const originalFetch = global.fetch;

// Mock fetch
const mockFetch = vi.fn();

describe("RewriteService", () => {
  let service: RewriteService;

  beforeEach(() => {
    // 在每个测试前设置 mock
    global.fetch = mockFetch;
    
    service = new RewriteService({
      apiUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-api-key",
      model: "gpt-4o-mini",
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // 恢复原始 fetch
    global.fetch = originalFetch;
  });

  describe("rewrite", () => {
    it("should return empty string for empty input", async () => {
      const result = await service.rewrite("");
      expect(result.success).toBe(true);
      expect(result.polished).toBe("");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return empty string for whitespace-only input", async () => {
      const result = await service.rewrite("   ");
      expect(result.success).toBe(true);
      expect(result.polished).toBe("");
    });

    it("should call API and return polished text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "润色后的文本",
              },
            },
          ],
        }),
      });

      const result = await service.rewrite("嗯，那个，原始文本");

      expect(result.success).toBe(true);
      expect(result.polished).toBe("润色后的文本");
      expect(result.original).toBe("嗯，那个，原始文本");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should handle API error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await service.rewrite("测试文本");

      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
      expect(result.polished).toBe("测试文本"); // 失败时返回原文
    });

    it("should handle network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.rewrite("测试文本");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
      expect(result.polished).toBe("测试文本");
    });

    it("should handle empty API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [],
        }),
      });

      const result = await service.rewrite("测试文本");

      expect(result.success).toBe(false);
      expect(result.error).toContain("空结果");
    });

    it("should send correct request body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "结果" } }],
        }),
      });

      await service.rewrite("测试");

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.model).toBe("gpt-4o-mini");
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(4096);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toBe("测试");
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", async () => {
      service.updateConfig({
        model: "new-model",
        temperature: 0.5,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "结果" } }],
        }),
      });

      await service.rewrite("测试");

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.model).toBe("new-model");
      expect(body.temperature).toBe(0.5);
    });
  });

  describe("without API key", () => {
    it("should skip API call and return original text", async () => {
      const noKeyService = new RewriteService({
        apiUrl: "https://api.example.com",
        apiKey: "",
        model: "test",
      });

      const result = await noKeyService.rewrite("测试文本");

      expect(result.success).toBe(true);
      expect(result.polished).toBe("测试文本");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("rewriteText", () => {
  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should be a convenience function for RewriteService", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "润色结果" } }],
      }),
    });

    const result = await rewriteText("原始文本", {
      apiUrl: "https://api.example.com",
      apiKey: "key",
      model: "model",
    });

    expect(result).toBe("润色结果");
  });
});

describe("createRewriteServiceFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return null if env vars are missing", () => {
    delete process.env.transcribe_model_api_url;
    delete process.env.transcribe_model_api_key;
    delete process.env.transcribe_model;

    const service = createRewriteServiceFromEnv();
    expect(service).toBeNull();
  });

  it("should create service when all env vars are set", () => {
    process.env.transcribe_model_api_url = "https://api.example.com";
    process.env.transcribe_model_api_key = "test-key";
    process.env.transcribe_model = "test-model";

    const service = createRewriteServiceFromEnv();
    expect(service).toBeInstanceOf(RewriteService);
  });
});
