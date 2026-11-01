import type { SurveyDefinition, SurveyOp } from "../contracts/index.js";
import { canonicalContentJson, canonicalSurveyJson } from "./hash.js";
import { applySurveyOps } from "./ops.js";
import { validateSurveyDefinition, validateSurveyDesign } from "./validate-definition.js";
import { canRecordAiAddedQuestions } from "./source-provenance.js";

export function humanizeReviewText(text: string): string {
  return text.replace(/\b[A-Za-z][A-Za-z0-9_-]*\s*构念/g, "研究用途")
    .replace(/构念\s*[A-Za-z][A-Za-z0-9_-]*/g, "研究用途")
    .replace(/研究用途\s+(?=[\u3400-\u9fff])/g, "研究用途");
}

export function sanitizeReviewImpact(text: string, singleChoice = false): string {
  return (singleChoice && /重复计数|重复统计/.test(text)) || /系统性.{0,8}(?:偏高|偏低|抬高|降低|歪曲|失真|偏向)|(?:偏高|偏低|抬高|降低|歪曲|失真).{0,8}系统性|(?:结果|结论|分布|指标).{0,8}(?:不可用|不可解释|完全失真)/.test(text)
    ? "可能影响回答分布；实际影响需要通过试填或数据检验。" : text;
}

export function sanitizeReviewRecommendation(text: string, hasOps: boolean): string {
  const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? [];
  const kept = parts.filter((part) => {
    const completed = /(?:我|我们|系统)(?:已|已经).{0,40}(?:应用|保存|写入|改好|修改完成|填入|设置|补充|添加)|(?:已|已经)(?:成功)?(?:应用|保存|写入|修改完成)|\b(?:i|we) (?:have |already )?(?:applied|saved|changed|updated)\b/i.test(part);
    const unavailable = !hasOps && !/(?:不能|无法|不可|尚未|未|没有|不).{0,5}(?:直接|自动|应用|修改)/.test(part) &&
      /(?:已|已经|我).{0,30}(?:附上|提供|生成|列入)|可直接应用|一键应用|\b(?:attached|ready to apply|apply this change)\b/i.test(part);
    return !completed && !unavailable;
  });
  return kept.join("").trim() || (/[\u3400-\u9fff]/.test(text)
    ? "请结合研究目的核对后，手动调整这项内容。"
    : "Review this suggestion against the research purpose and make any needed changes manually.");
}

export function unresolvedReviewChoice(ops: readonly SurveyOp[], definition: SurveyDefinition): "period" | "placeholder" | "required" | "order" | "scope" | "metadata" | "specify" | "routing" | "response_format" | "structure" | "mapping" | "source_capacity" | null {
  if (ops.some((op) => {
    if (op.op !== "set_meta") return false;
    if (op.title !== undefined || op.description !== undefined || op.consent !== undefined) return true;
    if (op.researchDesign === undefined) return false;
    if (!op.researchDesign || !definition.researchDesign) return true;
    const withoutMappings = (design: NonNullable<SurveyDefinition["researchDesign"]>) => ({
      ...design, constructs: design.constructs.map(({ questionIds: _questionIds, ...construct }) => construct),
    });
    return canonicalSurveyJson(withoutMappings(op.researchDesign)) !== canonicalSurveyJson(withoutMappings(definition.researchDesign));
  })) return "metadata";
  if (ops.some((op) => op.op === "set_page_jump" ||
    (op.op === "update_question" && "showIf" in op.patch) ||
    (op.op === "add_question" && "showIf" in op.question))) return "routing";
  if (ops.some((op) => {
    if (op.op !== "update_question" || typeof op.patch.title !== "string") return false;
    const question = definition.questions.find((item) => item.id === op.questionId);
    if (!question || !("options" in question)) return false;
    const options = Array.isArray(op.patch.options) ? op.patch.options : question.options;
    const labels = options.map((option) => option && typeof option === "object" && typeof option.label === "string" ? option.label : "");
    const agreement = labels.some((label) => /^(?:非常|比较|完全|有点)?(?:同意|赞同|赞成|支持|agree|strongly agree)$/i.test(label)) &&
      labels.some((label) => /^(?:非常|比较|完全|有点)?(?:不(?:同意|赞同|赞成|支持)|反对|disagree|strongly disagree)$/i.test(label));
    return agreement && !/同意|赞同|赞成|支持|agree/i.test(op.patch.title);
  })) return "response_format";
  if (ops.some((op) => {
    const value = op.op === "update_question" ? op.patch.options : op.op === "add_question" ? op.question.options : undefined;
    return Array.isArray(value) && value.some((option) => option && typeof option === "object" &&
      typeof option.label === "string" && /请(?:注明|填写|说明)|please specify/i.test(option.label));
  })) return "specify";
  if (ops.some((op) => op.op === "move_question")) return "order";
  if (ops.some((op) => op.op === "update_question" && op.patch.required === true &&
    definition.questions.some((question) => question.id === op.questionId && !question.required))) return "required";
  const candidate = JSON.stringify(ops.map((op) => op.op === "set_meta" && op.researchDesign !== undefined
    ? { ...op, researchDesign: undefined } : op));
  if (/例如|比如|such as|for example/i.test(candidate)) return "scope";
  if (/请(?:在此处|自行|作者)(?:补充|补全|填写)|待(?:补充|补全|填写|确认|定义)|\b(?:insert|fill in) (?:the )?(?:question|text|title)\b/i.test(candidate)) return "placeholder";
  const originalIssues = new Set(validateSurveyDefinition(definition).map((issue) => JSON.stringify([issue.path, issue.code, issue.message])));
  const result = applySurveyOps(definition, ops);
  if (result.rejected.length === 0 && !canRecordAiAddedQuestions(definition, result.definition)) return "source_capacity";
  if (result.rejected.length === 0 && validateSurveyDefinition(result.definition).some((issue) => !originalIssues.has(JSON.stringify([issue.path, issue.code, issue.message])))) return "structure";
  if (result.rejected.length === 0 && definition.researchDesign?.constructs.length) {
    const designIssues = (value: SurveyDefinition) => validateSurveyDesign(value).filter((issue) =>
      !issue.path.startsWith("researchDesign.pretest.") && ["design_construct_unmapped", "design_unknown_question", "design_unknown_reference"].includes(issue.code));
    const originalDesignIssues = new Set(designIssues(definition).map((issue) => JSON.stringify([issue.path, issue.code, issue.message])));
    const mapped = new Set(result.definition.researchDesign?.constructs.flatMap((item) => item.questionIds) ?? []);
    const oldIds = new Set(definition.questions.map((question) => question.id));
    if (designIssues(result.definition).some((issue) => !originalDesignIssues.has(JSON.stringify([issue.path, issue.code, issue.message]))) ||
      result.definition.questions.some((question) => question.type !== "statement" && !oldIds.has(question.id) && !mapped.has(question.id))) return "mapping";
  }
  const { sourceRecords: _sourceRecords, ...current } = definition;
  const source = canonicalContentJson(current).toLowerCase();
  const periods = candidate.match(/(?:过去|最近|近)\s*(?:\d+|[一二三四五六七八九十两半]+)\s*(?:个)?(?:天|周|月|学期|季度|年)|(?:本周|本月|本学期|今年|去年)|(?:last|past)\s+(?:\d+|one|two|three|six|twelve)\s+(?:days?|weeks?|months?|years?)/gi) ?? [];
  return periods.some((period) => !source.includes(period.toLowerCase())) ? "period" : null;
}
