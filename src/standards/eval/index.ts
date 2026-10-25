// 评测集装配与交叉校验：引用闭合（checkId 存在）、优秀案例映射与变量
// 字典一致、id 全局唯一。目录数据在 ../index，这里只做评测集侧。
import { surveyVariables } from "../../core/variables.js";
import { validateSurveyDefinition } from "../../core/validate-definition.js";
import { STANDARDS_CHECKS, type StandardsCheck } from "../index.js";
import { excellentCases } from "./excellent.js";
import { defectCases } from "./defects.js";
import { edgeCases } from "./edge.js";
import { noviceTasks } from "./tasks.js";
import {
  ExcellentCaseSchema,
  DefectCaseSchema,
  EdgeCaseSchema,
  NoviceTaskSchema,
  type ExcellentCase,
  type DefectCase,
  type EdgeCase,
  type NoviceTask,
} from "./schema.js";

export { buildBlindEdgePacket, summarizeReviewDecisions, ReviewDecisionSchema } from "./review.js";
export type { ReviewDecision } from "./review.js";

export interface EvalDatasetIssue {
  path: string;
  message: string;
}

export interface LoadedEvalDataset {
  excellent: ExcellentCase[];
  defects: DefectCase[];
  edge: EdgeCase[];
  tasks: NoviceTask[];
  issues: EvalDatasetIssue[];
}

export function loadEvalDataset(): LoadedEvalDataset {
  const issues: EvalDatasetIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  const checkIds = new Set(STANDARDS_CHECKS.map((c: StandardsCheck) => c.id));

  const excellent = excellentCases.map((entry) => {
    const parsed = ExcellentCaseSchema.safeParse(entry);
    if (!parsed.success) {
      issue(entry.id ?? "<excellent?>", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return entry;
    }
    for (const v of validateSurveyDefinition(entry.definition)) {
      issue(entry.id, `优秀案例结构不合法：${v.path} ${v.code}`);
    }
    const varKindsByQuestion = new Map<string, Set<string>>();
    for (const variable of surveyVariables(entry.definition)) {
      const set = varKindsByQuestion.get(variable.questionId) ?? new Set<string>();
      set.add(variable.kind);
      varKindsByQuestion.set(variable.questionId, set);
    }
    const mappedQuestions = new Set(entry.mapping.map((m) => m.questionId));
    for (const [questionId, kinds] of varKindsByQuestion) {
      if (!mappedQuestions.has(questionId)) {
        issue(entry.id, `题目 ${questionId} 产出变量但映射未覆盖`);
      }
      const entryKinds = new Set(
        entry.mapping.filter((m) => m.questionId === questionId).map((m) => m.variableKind),
      );
      for (const kind of kinds) {
        if (!entryKinds.has(kind)) {
          issue(entry.id, `题目 ${questionId} 的映射缺少实际变量类型 ${kind}`);
        }
      }
    }
    for (const m of entry.mapping) {
      if (!varKindsByQuestion.has(m.questionId)) {
        issue(entry.id, `映射指向不产出变量的题目 ${m.questionId}`);
      }
    }
    for (const s of entry.strengths) {
      if (!checkIds.has(s.checkId)) issue(entry.id, `strengths 引用未知检查项 ${s.checkId}`);
    }
    return entry;
  });

  const defects = defectCases.map((entry) => {
    const parsed = DefectCaseSchema.safeParse(entry);
    if (!parsed.success) {
      issue(entry.id ?? "<defect?>", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return entry;
    }
    // 缺陷案例的缺陷只在方法学层：结构不合法（该归 validate-definition 管的）
    // 不是合格缺陷案例。
    for (const v of validateSurveyDefinition(entry.definition)) {
      issue(entry.id, `缺陷案例结构不合法（缺陷只允许方法学层）：${v.path} ${v.code}`);
    }
    for (const p of entry.planted) {
      if (!checkIds.has(p.checkId)) issue(entry.id, `planted 引用未知检查项 ${p.checkId}`);
    }
    for (const t of entry.mustNotFlag ?? []) {
      if (!checkIds.has(t.checkId)) issue(entry.id, `mustNotFlag 引用未知检查项 ${t.checkId}`);
    }
    const plantedIds = new Set(entry.planted.map((p) => `${p.checkId}@${p.at}`));
    if (plantedIds.size !== entry.planted.length) {
      issue(entry.id, "planted 存在重复的 checkId@at 标注");
    }
    return entry;
  });

  const edge = edgeCases.map((entry) => {
    const parsed = EdgeCaseSchema.safeParse(entry);
    if (!parsed.success) {
      issue(entry.id ?? "<edge?>", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return entry;
    }
    for (const id of entry.relatedCheckIds) {
      if (!checkIds.has(id)) issue(entry.id, `relatedCheckIds 引用未知检查项 ${id}`);
    }
    return entry;
  });

  const tasks = noviceTasks.map((entry) => {
    const parsed = NoviceTaskSchema.safeParse(entry);
    if (!parsed.success) {
      issue(entry.id ?? "<task?>", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return entry;
    }
    return entry;
  });

  const allIds = [
    ...excellent.map((c) => c.id),
    ...defects.map((c) => c.id),
    ...edge.map((c) => c.id),
    ...tasks.map((c) => c.id),
  ];
  if (new Set(allIds).size !== allIds.length) {
    issue("<dataset>", "评测案例 id 存在跨类别重复");
  }

  return { excellent, defects, edge, tasks, issues };
}
