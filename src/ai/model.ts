// 最小模型口（issue #223 §6）：独立站宿主注入实现即可跑受限推理流程；主站
// copilot 不经此口（复用自家推理车道）。包不关心 provider、计费与重试策略。
export interface SurveyModelPort {
  complete(req: {
    system: string;
    user: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string }>;
}
