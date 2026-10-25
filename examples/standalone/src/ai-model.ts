// OpenAI 兼容模型 adapter（独立站示例，issue #223 §6）：任何 /v1/chat/completions
// 形态的端点（OpenAI、兼容网关、本地 vLLM 等）都可用环境变量接入；未配置时
// 由调用方降级（AI 面板显示未配置）。包不关心 provider——这里是宿主示例实现。
import type { SurveyModelPort } from "@mango-write/surveys/ai";

export interface OpenAiModelOptions {
  url: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export function createOpenAiModel(opts: OpenAiModelOptions): SurveyModelPort {
  return {
    async complete(req) {
      const timeout = AbortSignal.timeout(req.timeoutMs ?? opts.timeoutMs ?? 60_000);
      const response = await fetch(opts.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
        signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
      });
      if (!response.ok) {
        throw new Error(`模型端点 HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("模型没有返回内容");
      return { text };
    },
  };
}
