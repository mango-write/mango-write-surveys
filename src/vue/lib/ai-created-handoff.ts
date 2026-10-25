// survey_create 交付帧 → 工作区落地提示的一次性交接（issue #217）。
// 生成会话是 global scope（survey_edit 只对 survey scope 开放，scope 建会话时
// 定死），落进工作区的是新开的 survey 会话——AI 的「我建了什么」经本单槽带过
// 去。内存级：刷新即清空，落地提示天然只出现一次。
import type { ToolSurveyDelivery } from "../../contracts/index.js";

export type AiCreatedSurveyHandoff = Extract<
  ToolSurveyDelivery,
  { type: "survey_create" }
>;

let pending: AiCreatedSurveyHandoff | null = null;

/** 收帧方（列表页/工作区）在导航前写入。 */
export function setAiCreatedSurveyHandoff(
  handoff: AiCreatedSurveyHandoff,
): void {
  pending = handoff;
}

/** 工作区 load 成功后取走；surveyId 不匹配不清槽——绕路打开别的问卷不丢提示。 */
export function takeAiCreatedSurveyHandoff(
  surveyId: string,
): AiCreatedSurveyHandoff | null {
  if (pending?.surveyId !== surveyId) return null;
  const handoff = pending;
  pending = null;
  return handoff;
}

/** 测试专用：清空单槽（模块状态跨用例泄漏防线）。 */
export function __resetAiCreatedSurveyHandoffForTest(): void {
  pending = null;
}
