/**
 * 润色服务集成测试
 * 
 * 使用真实的 API 进行端到端测试
 * 需要环境变量：
 * - transcribe_model_api_url
 * - transcribe_model_api_key
 * - transcribe_model
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RewriteService, createRewriteServiceFromEnv } from "../../rewrite";

// 保存原始的 fetch
const originalFetch = global.fetch;

// 检查是否可以运行集成测试
function canRunIntegrationTests(): { canRun: boolean; reason?: string } {
  if (!process.env.transcribe_model_api_url) {
    return {
      canRun: false,
      reason: "缺少环境变量 transcribe_model_api_url",
    };
  }

  if (!process.env.transcribe_model_api_key) {
    return {
      canRun: false,
      reason: "缺少环境变量 transcribe_model_api_key",
    };
  }

  if (!process.env.transcribe_model) {
    return {
      canRun: false,
      reason: "缺少环境变量 transcribe_model",
    };
  }

  return { canRun: true };
}

const testCheck = canRunIntegrationTests();

describe("RewriteService 集成测试", () => {
  if (!testCheck.canRun) {
    it.skip(`跳过集成测试: ${testCheck.reason}`, () => {});
    return;
  }

  let service: RewriteService;

  beforeAll(() => {
    // 恢复真实的 fetch，防止被 mock 污染
    global.fetch = originalFetch;
    
    service = new RewriteService({
      apiUrl: process.env.transcribe_model_api_url!,
      apiKey: process.env.transcribe_model_api_key!,
      model: process.env.transcribe_model!,
    });
  });

  afterAll(() => {
    // 恢复可能的 mock
    global.fetch = originalFetch;
  });

  it("应该成功润色简单文本", async () => {
    const result = await service.rewrite("嗯，那个，今天天气不错");

    expect(result.success).toBe(true);
    expect(result.polished).toBeTruthy();
    expect(result.polished).not.toBe(result.original);
    expect(result.original).toBe("嗯，那个，今天天气不错");
    console.log(`原文: ${result.original}`);
    console.log(`润色: ${result.polished}`);
  }, 30000);

  it("应该成功润色长文本", async () => {
    const longText = "嗯，那个，我今天想说的是，嗯，人工智能正在改变我们的生活，那个，我们应该，嗯，更好地利用这些技术";

    const result = await service.rewrite(longText);

    expect(result.success).toBe(true);
    expect(result.polished).toBeTruthy();
    expect(result.polished.length).toBeGreaterThan(0);
    console.log(`原文: ${result.original}`);
    console.log(`润色: ${result.polished}`);
  }, 30000);

  it("应该保留没有口语化的文本", async () => {
    const formalText = "今天天气很好，我们去公园散步吧。";

    const result = await service.rewrite(formalText);

    expect(result.success).toBe(true);
    expect(result.polished).toBeTruthy();
    console.log(`原文: ${result.original}`);
    console.log(`润色: ${result.polished}`);
  }, 30000);

  it("应该正确处理空白文本", async () => {
    const result = await service.rewrite("   ");

    expect(result.success).toBe(true);
    expect(result.polished).toBe("");
  });

  it("应该正确处理空文本", async () => {
    const result = await service.rewrite("");

    expect(result.success).toBe(true);
    expect(result.polished).toBe("");
  });
});

describe("createRewriteServiceFromEnv 集成测试", () => {
  if (!testCheck.canRun) {
    it.skip(`跳过集成测试: ${testCheck.reason}`, () => {});
    return;
  }

  beforeAll(() => {
    // 恢复真实的 fetch
    global.fetch = originalFetch;
  });

  it("应该从环境变量创建可用的服务", async () => {
    const service = createRewriteServiceFromEnv();

    expect(service).not.toBeNull();
    if (!service) return;

    const result = await service.rewrite("嗯，测试一下");

    expect(result.success).toBe(true);
    expect(result.polished).toBeTruthy();
    console.log(`原文: ${result.original}`);
    console.log(`润色: ${result.polished}`);
  }, 30000);
});
