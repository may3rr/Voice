/**
 * 文本润色模块
 *
 * 使用 OpenAI 兼容 API 对转写文本进行润色
 * 去除语气词、修正语法、保持原意
 */

import type { RewriteConfig, RewriteResult } from "../../shared";

/**
 * 默认润色配置
 */
export const DEFAULT_REWRITE_CONFIG: Omit<RewriteConfig, "apiUrl" | "apiKey" | "model"> = {
  temperature: 0.3,
  maxTokens: 4096,
};

/**
 * 润色系统提示词
 */
const SYSTEM_PROMPT = `你是一个专业的文字编辑助手。你的任务是对语音转写的文本进行润色处理。

具体要求：
1. 删除口语中的语气词（如：嗯、啊、呃、那个、这个、就是、然后、所以说、反正、其实、基本上等）
2. 删除重复和冗余的表达
3. 修正明显的语法错误
4. 保持原意不变，不要添加新内容
5. 保持文本的自然流畅
6. 如果是中文，保持中文；如果是其他语言，保持原语言

请直接输出润色后的文本，不要添加任何解释或说明。`;

/**
 * 文本润色服务
 *
 * @example
 * ```typescript
 * const service = new RewriteService({
 *   apiUrl: 'https://api.openai.com/v1/chat/completions',
 *   apiKey: 'your-api-key',
 *   model: 'gpt-4o-mini'
 * });
 *
 * const result = await service.rewrite('嗯，那个，我想说的是...');
 * console.log(result.polished);
 * ```
 */
export class RewriteService {
  private config: Required<RewriteConfig>;

  /**
   * 创建润色服务实例
   *
   * @param config - 润色配置
   */
  constructor(config: RewriteConfig) {
    this.config = {
      ...config,
      temperature: config.temperature ?? DEFAULT_REWRITE_CONFIG.temperature!,
      maxTokens: config.maxTokens ?? DEFAULT_REWRITE_CONFIG.maxTokens!,
    };
  }

  /**
   * 对文本进行润色
   *
   * @param text - 原始文本
   * @returns 润色结果
   */
  async rewrite(text: string): Promise<RewriteResult> {
    const trimmedText = text.trim();

    if (!trimmedText) {
      return {
        original: text,
        polished: "",
        success: true,
      };
    }

    if (!this.config.apiKey) {
      console.warn("[RewriteService] 未配置 API Key，跳过润色");
      return {
        original: text,
        polished: text,
        success: true,
      };
    }

    try {
      const response = await fetch(this.config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: trimmedText },
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[RewriteService] API 请求失败: ${response.status}`,
          errorText
        );
        return {
          original: text,
          polished: text,
          success: false,
          error: `API 请求失败: ${response.status}`,
        };
      }

      const data = await response.json();
      const polished = data.choices?.[0]?.message?.content?.trim();

      if (!polished) {
        console.warn("[RewriteService] API 返回空结果");
        return {
          original: text,
          polished: text,
          success: false,
          error: "API 返回空结果",
        };
      }

      return {
        original: text,
        polished,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[RewriteService] 润色失败:", errorMessage);
      return {
        original: text,
        polished: text,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 更新配置
   *
   * @param config - 新配置（部分）
   */
  updateConfig(config: Partial<RewriteConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}

/**
 * 快捷润色函数
 *
 * @param text - 原始文本
 * @param config - 润色配置
 * @returns 润色后的文本
 */
export async function rewriteText(
  text: string,
  config: RewriteConfig
): Promise<string> {
  const service = new RewriteService(config);
  const result = await service.rewrite(text);
  return result.polished;
}

/**
 * 从环境变量创建润色服务
 *
 * @returns 润色服务实例（如果配置完整）
 */
export function createRewriteServiceFromEnv(): RewriteService | null {
  const apiUrl = process.env.transcribe_model_api_url;
  const apiKey = process.env.transcribe_model_api_key;
  const model = process.env.transcribe_model;

  if (!apiUrl || !apiKey || !model) {
    console.warn(
      "[RewriteService] 环境变量不完整，无法创建润色服务",
      { apiUrl: !!apiUrl, apiKey: !!apiKey, model: !!model }
    );
    return null;
  }

  return new RewriteService({ apiUrl, apiKey, model });
}
