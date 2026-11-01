// 可运行的受限问卷推理流程（issue #223 §6）：一次模型调用产出完整问卷定义，
// JSON 解析 → schema 形状校验 → 语义校验，只返回候选、不落库。编辑循环不在
// 此——改卷由宿主驱动工具完成（survey_read / survey_edit 已具备）。
import {
  SurveyDefinitionSchema,
  AI_GENERATED_SOURCE_ID,
  canonicalSurveyJson,
  validateSurveyDefinition,
  type SurveyDefinition,
} from "../core/index.js";

import type { SurveyModelPort } from "./model.js";
import { QUESTION_PAYLOAD_HINT, RESEARCH_DESIGN_HINT } from "./tools.js";
import { hasExplicitTimeBudget } from "./time-budget.js";
import { normalizeGeneratedFields, normalizeResearchMappings, redundantConsentQuestion, stripUnverifiedParticipationText, stripUnverifiedPopulation, unknownResearchMappings, unmeasuredAnalysisGroup, unsupportedGroupComparison, unverifiedGeneratedInstitution, unverifiedGeneratedPeriod, unverifiedPopulationScope, unverifiedReliabilityClaim } from "./generated-evidence.js";

const SYSTEM_PROMPT =
  "你是问卷设计助手。根据用户给出的标题与需求简述，产出一份完整的问卷定义 JSON，不要输出 JSON 以外的任何文字。\n" +
  "结构：{version:1,title,description,consent,questions:[...],pages:[...],researchDesign:{...}}。" +
  "questions 每项含 id/type/title(纯文本)/required 与题型载荷；pages 每项含 id/title/questionIds（每题恰属一页；页序 = 全卷题序）。选项、矩阵行列及子项有 id；被条件或映射引用的 id 必须一致。\n" +
  RESEARCH_DESIGN_HINT + "\n" +
  "需求信息不足时先自问：研究问题能否被这些题回答、人群能否被触达、分析计划能否用现有统计完成；" +
  "缺什么就写进 researchDesign.pendingDecisions，不要虚构人群、许可、预算或「已验证」状态。\n" +
  QUESTION_PAYLOAD_HINT + "\n" +
  "显示条件 showIf 只能引用排在前面的题；矩阵/矩阵填空/排序/多项填空/说明块不能作条件源。" +
  "title 必须逐字使用用户给定的标题。";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const issuesBrief = (issues: Array<{ path: string; code: string; message: string }>): string =>
  issues.map((issue) => `${issue.path} ${issue.code}: ${issue.message}`).join("；");

export async function generateSurveyDefinition(
  model: SurveyModelPort,
  input: { title: string; brief: string },
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: true; definition: SurveyDefinition } | { ok: false; error: string }> {
  let text: string;
  try {
    ({ text } = await model.complete({
      system: SYSTEM_PROMPT,
      user: `问卷标题：${input.title}\n需求简述：${input.brief}`,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    }));
  } catch (err) {
    return { ok: false, error: `模型调用失败：${err instanceof Error ? err.message : String(err)}` };
  }
  const raw = extractJson(text);
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "模型没有返回可解析的问卷定义 JSON。" };
  }
  // 标题以用户给定为准（与 survey_create 同一口径，模型复述可能走样）。
  const { sourceRecords: _sourceRecords, ...candidate } = raw as Record<string, unknown>;
  const parsed = SurveyDefinitionSchema.safeParse({ ...normalizeGeneratedFields(candidate), title: input.title });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `definition 形状不合法：${issue ? `${issue.path.join(".")}: ${issue.message}` : "未知错误"}`,
    };
  }
  const definition = parsed.data as SurveyDefinition;
  const sourceTexts = [input.title, input.brief];
  if (redundantConsentQuestion(definition)) return { ok: false, error: "填写前已有参与同意勾选，请移除重复的同意题后重试。" };
  if (unverifiedGeneratedPeriod(definition, sourceTexts) || unverifiedGeneratedInstitution(definition, sourceTexts) || unverifiedPopulationScope(definition, sourceTexts)) return { ok: false, error: "问卷包含未经确认的时间范围、机构或人群，请核对后重试。" };
  const sanitized = stripUnverifiedParticipationText(definition, sourceTexts);
  stripUnverifiedPopulation(definition, sourceTexts);
  if (sanitized.privacy || sanitized.duration) return { ok: false, error: "填写说明包含未经确认的数据处理或时长承诺，请核对后重试。" };
  if (!definition.researchDesign?.researchQuestion.trim() || !definition.researchDesign.analysisPlan.trim()) return { ok: false, error: "研究问题和预期分析尚未整理，请补充后重试。" };
  if (unmeasuredAnalysisGroup(definition)) return { ok: false, error: "分析计划引用了问卷没有收集的分组信息，请核对后重试。" };
  if (unsupportedGroupComparison(definition)) return { ok: false, error: "分析计划对两组以上的分组默认了均值比较，请改用描述与交叉表或说明限制后重试。" };
  if (unverifiedReliabilityClaim(definition)) return { ok: false, error: "分析计划声称的信度指标不适用于单题构念，请限定多题构念或调整题目后重试。" };
  if (normalizeResearchMappings(definition).length || unknownResearchMappings(definition).length) return { ok: false, error: "题目与研究用途的对应关系尚不完整，请修正后重试。" };
  definition.sourceRecords = definition.questions.filter((question) => question.type !== "statement").map((question) => ({
    sourceId: AI_GENERATED_SOURCE_ID, questionId: question.id, language: "und", baselineQuestion: canonicalSurveyJson(question),
  }));
  const design = definition.researchDesign;
  if (design?.timeBudgetMinutes !== undefined && !hasExplicitTimeBudget(design.timeBudgetMinutes, [input.title, input.brief])) {
    delete design.timeBudgetMinutes;
  }
  const issues = validateSurveyDefinition(definition);
  if (issues.length > 0) return { ok: false, error: `语义校验未通过：${issuesBrief(issues)}` };
  return { ok: true, definition };
}
