// 问卷交付载荷摘出：宿主在 tool_step done 帧消费（chart-tools 同一模式），
// 只进 UI 不回灌模型。非问卷工具、失败结果或零应用返回 null。
import type {
  SurveyIssue,
  SurveyOp,
  SurveyReviewFinding,
  ToolSurveyDelivery,
} from "../contracts/index.js";

export function surveyDeliveryFromResult(tool: string, result: unknown): ToolSurveyDelivery | null {
  if (tool !== "survey_edit" && tool !== "survey_create" && tool !== "survey_review") return null;
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) return null;
  const r = result as Record<string, unknown>;
  const issues = Array.isArray(r.issues) && r.issues.length > 0 ? (r.issues as SurveyIssue[]) : undefined;
  // 操作身份与校验基线是交付的必选语义：缺失视为不完整结果，不进 UI。
  if (typeof r.operationId !== "string" || r.operationId.length === 0) return null;
  if (tool === "survey_review") {
    if (typeof r.surveyId !== "string" || !Array.isArray(r.findings)) return null;
    if (typeof r.baseDraftVersion !== "number" || !Number.isInteger(r.baseDraftVersion) || r.baseDraftVersion < 1)
      return null;
    if (typeof r.summary !== "string") return null;
    return {
      type: "survey_review",
      surveyId: r.surveyId,
      operationId: r.operationId,
      baseDraftVersion: r.baseDraftVersion,
      summary: r.summary,
      findings: r.findings as SurveyReviewFinding[],
    };
  }
  if (tool === "survey_create") {
    if (typeof r.surveyId !== "string" || typeof r.title !== "string") return null;
    return {
      type: "survey_create",
      surveyId: r.surveyId,
      operationId: r.operationId,
      title: r.title,
      ...(issues ? { issues } : {}),
    };
  }
  if (!Array.isArray(r.appliedOps) || r.appliedOps.length === 0 || typeof r.surveyId !== "string")
    return null;
  if (typeof r.baseDraftVersion !== "number" || !Number.isInteger(r.baseDraftVersion) || r.baseDraftVersion < 1)
    return null;
  const rejected = Array.isArray(r.rejected) && r.rejected.length > 0
    ? (r.rejected as { reason: string }[])
    : undefined;
  return {
    type: "survey_edit",
    surveyId: r.surveyId,
    operationId: r.operationId,
    baseDraftVersion: r.baseDraftVersion,
    summary: typeof r.summary === "string" ? r.summary : "",
    appliedOps: r.appliedOps as SurveyOp[],
    ...(rejected ? { rejected } : {}),
    ...(issues ? { issues } : {}),
  };
}
