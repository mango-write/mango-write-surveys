// 问卷操作词表与纯变换引擎（issue #217）：AI 建卷/改卷与画布编辑共用的唯一
// 语义层。所有变换 clone-on-write（沿改动路径浅拷贝），按 id 定位；id 未知或不
// 合法的操作被**拒绝**（rejected 带原因）而不是抛错——调用方（Copilot 工具、
// 页面桥）把拒绝原因如实带回给模型/用户。每个操作应用后整体过 SurveyDefinitionSchema，
// 保证返回的 definition 恒为形状合法；语义层面（条件源、跳页方向等）的结果经
// validateSurveyDefinition 以 issues 形式附回，不阻断应用——空页、未完成条件是
// 草稿合法中间态。
import { z } from "zod";

import {
  SURVEY_LIMITS,
  SurveyConditionSchema,
  SurveyDefinitionSchema,
  SurveyQuestionSchema,
  SurveyResearchDesignSchema,
  type SurveyCondition,
  type SurveyDefinition,
  type SurveyIssue,
  type SurveyPage,
  type SurveyQuestion,
  type SurveyResearchDesign,
} from "./definition.js";
import { validateSurveyDefinition, validateSurveyDesign } from "./validate-definition.js";

// 换题型时载荷可原样保留的分组：选项族（单选/多选/下拉/排序/图片单选/图片多选，
// 选项共用；imageFileId 只属于图片题型，转纯文本选项时随 schema 剥离）与矩阵族
// （行共用；列只在两端都有列时保留）。分组语义唯一来源在这里；画布的换题型与
// AI 的 update_question 都走它。
export const OPTION_FAMILY_TYPES = [
  "single",
  "multiple",
  "dropdown",
  "ranking",
  "image_single",
  "image_multiple",
] as const;
export const MATRIX_FAMILY_TYPES = [
  "matrix_single",
  "matrix_multiple",
  "matrix_text",
] as const;

const idPattern = /^[A-Za-z0-9_-]+$/;

function defaultId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) ?? Math.random().toString(36).slice(2, 12);
  return `${prefix}${random}`;
}

export interface SurveyOpsOptions {
  /** id 生成器（题/页/选项/行/列/项的缺省 id）；缺省用随机串，测试可注入确定性实现。 */
  genId?: (prefix: string) => string;
}

export type SurveyOp =
  | {
      op: "set_meta";
      title?: string;
      description?: string;
      consent?: string;
      /** null = 清除研究设计（不要为了让诊断通过而留半份旧设计）。 */
      researchDesign?: SurveyResearchDesign | null;
    }
  | {
      op: "add_page";
      afterPageId?: string;
      title: string;
      description?: string;
      pageId?: string;
    }
  | { op: "update_page"; pageId: string; title?: string; description?: string }
  | { op: "remove_page"; pageId: string }
  | {
      op: "add_question";
      pageId: string;
      index?: number;
      /** 完整题目载荷；题目与选项/行/列/项 id 可省略（缺省生成）。 */
      question: Record<string, unknown>;
    }
  | { op: "update_question"; questionId: string; patch: Record<string, unknown> }
  | { op: "remove_question"; questionId: string }
  | { op: "move_question"; questionId: string; toPageId: string; index: number }
  | {
      op: "set_page_jump";
      pageId: string;
      /** null = 清除跳页设置。 */
      jump: { when: SurveyCondition; targetPageId: string } | null;
    }
  | { op: "replace_all"; definition: SurveyDefinition };

const metaOpSchema = z.object({
  op: z.literal("set_meta"),
  title: z.string().min(1).max(SURVEY_LIMITS.maxTitleLength).optional(),
  description: z.string().max(SURVEY_LIMITS.maxDescriptionLength).optional(),
  consent: z.string().max(SURVEY_LIMITS.maxConsentLength).optional(),
  researchDesign: SurveyResearchDesignSchema.nullable().optional(),
});

const addPageOpSchema = z.object({
  op: z.literal("add_page"),
  afterPageId: z.string().optional(),
  title: z.string().min(1).max(SURVEY_LIMITS.maxPageTitleLength),
  description: z.string().max(SURVEY_LIMITS.maxPageDescriptionLength).optional(),
  pageId: z.string().min(1).max(64).regex(idPattern).optional(),
});

const updatePageOpSchema = z.object({
  op: z.literal("update_page"),
  pageId: z.string().min(1),
  title: z.string().min(1).max(SURVEY_LIMITS.maxPageTitleLength).optional(),
  description: z.string().max(SURVEY_LIMITS.maxPageDescriptionLength).optional(),
});

const removePageOpSchema = z.object({
  op: z.literal("remove_page"),
  pageId: z.string().min(1),
});

const addQuestionOpSchema = z.object({
  op: z.literal("add_question"),
  pageId: z.string().min(1),
  index: z.number().int().min(0).optional(),
  question: z.record(z.string(), z.unknown()),
});

const updateQuestionOpSchema = z.object({
  op: z.literal("update_question"),
  questionId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

const removeQuestionOpSchema = z.object({
  op: z.literal("remove_question"),
  questionId: z.string().min(1),
});

const moveQuestionOpSchema = z.object({
  op: z.literal("move_question"),
  questionId: z.string().min(1),
  toPageId: z.string().min(1),
  index: z.number().int().min(0),
});

const setPageJumpOpSchema = z.object({
  op: z.literal("set_page_jump"),
  pageId: z.string().min(1),
  /** null = 清除跳页设置。 */
  jump: z
    .object({
      when: SurveyConditionSchema,
      targetPageId: z.string().min(1),
    })
    .nullable(),
});

const replaceAllOpSchema = z.object({
  op: z.literal("replace_all"),
  definition: SurveyDefinitionSchema,
});

export const SurveyOpSchema = z.discriminatedUnion("op", [
  metaOpSchema,
  addPageOpSchema,
  updatePageOpSchema,
  removePageOpSchema,
  addQuestionOpSchema,
  updateQuestionOpSchema,
  removeQuestionOpSchema,
  moveQuestionOpSchema,
  setPageJumpOpSchema,
  replaceAllOpSchema,
]);

export interface SurveyOpRejection {
  /** 原始输入（未通过 op schema 解析时保留原样，便于回传模型对照）。 */
  op: unknown;
  reason: string;
}

export interface SurveyOpsResult {
  definition: SurveyDefinition;
  /** 实际应用的操作（经解析与 id 归一后的形态，含生成的 id）。 */
  applied: SurveyOp[];
  rejected: SurveyOpRejection[];
  /** 应用于最终 definition 的语义校验结果（形状错误已在逐操作闸拦下）。 */
  issues: SurveyIssue[];
}

// ── 内部工具 ─────────────────────────────────────────────────────────────

const pageOf = (definition: SurveyDefinition, questionId: string): SurveyPage | undefined =>
  definition.pages.find((page) => page.questionIds.includes(questionId));

const questionOf = (definition: SurveyDefinition, questionId: string): SurveyQuestion | undefined =>
  definition.questions.find((question) => question.id === questionId);

/** 按页序展开重建 questions 数组（页序 = 全卷题序的唯一口径）。 */
function rebuildQuestions(definition: SurveyDefinition): SurveyDefinition["questions"] {
  const byId = new Map(definition.questions.map((question) => [question.id, question]));
  return definition.pages.flatMap((page) =>
    page.questionIds.flatMap((id) => {
      const question = byId.get(id);
      return question ? [question] : [];
    }),
  );
}

function withPages(definition: SurveyDefinition, pages: SurveyPage[]): SurveyDefinition {
  return { ...definition, pages, questions: rebuildQuestions({ ...definition, pages }) };
}

/** 题目载荷（含嵌套选项/行/列/项）缺失 id 的补齐：AI 载荷只需给 label。 */
function normalizeQuestionIds(
  input: Record<string, unknown>,
  genId: (prefix: string) => string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...input };
  if (typeof next["id"] !== "string" || !next["id"]) next["id"] = genId("q");
  const listKeys: Array<[string, string]> = [
    ["options", "o"],
    ["rows", "r"],
    ["columns", "c"],
    ["items", "i"],
  ];
  for (const [key, prefix] of listKeys) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    next[key] = list.map((node) => {
      if (!node || typeof node !== "object") return node;
      const nodeRecord = node as Record<string, unknown>;
      if (typeof nodeRecord["id"] === "string" && nodeRecord["id"]) return node;
      return { ...nodeRecord, id: genId(prefix) };
    });
  }
  return next;
}

function firstSchemaReason(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "定义不合法";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

/** 换题型的同族规则：选项族保留 options（多选的 min/maxChoices 不属于其他题型，
 *  丢弃），矩阵族保留 rows、两端都有列时保留 columns（矩阵填空没有列）；跨族由
 *  调用方提供新载荷。 */
export function retargetQuestionType(
  question: SurveyQuestion,
  type: SurveyQuestion["type"],
): SurveyQuestion {
  const familyOf = (t: SurveyQuestion["type"]) =>
    (OPTION_FAMILY_TYPES as readonly string[]).includes(t)
      ? "option"
      : (MATRIX_FAMILY_TYPES as readonly string[]).includes(t)
        ? "matrix"
        : "other";
  if (question.type === type) return question;
  const kept = {
    id: question.id,
    title: question.title,
    required: question.required,
    ...(question.showIf ? { showIf: question.showIf } : {}),
  };
  if (familyOf(question.type) === "option" && familyOf(type) === "option") {
    const { minChoices: _min, maxChoices: _max, ...rest } = question as SurveyQuestion & {
      minChoices?: number;
      maxChoices?: number;
    };
    return { ...(rest as Record<string, unknown>), type } as SurveyQuestion;
  }
  if (familyOf(question.type) === "matrix" && familyOf(type) === "matrix") {
    const targetHasColumns = type !== "matrix_text";
    const source = question as unknown as { rows: unknown; columns?: unknown };
    const carried = { ...kept, type, rows: source.rows } as Record<string, unknown>;
    // 目标有列而旧载荷没有（矩阵填空 → 矩阵单/多选）：列必须由调用方另给，
    // 缺列会在 SurveyQuestionSchema 被拒——这里不造默认值。
    if (targetHasColumns && source.columns) carried["columns"] = source.columns;
    return carried as SurveyQuestion;
  }
  // 跨族：只有公共字段可保留，载荷必须另给（缺载荷会在终验被拒）。
  return { ...kept, type } as SurveyQuestion;
}

/** update_question 的合并语义：同题型浅合并 patch；showIf 显式 null = 清除；
 *  换题型按 retargetQuestionType 的同族/跨族规则。返回 null = 合并结果不合法。 */
function mergeQuestionPatch(
  current: SurveyQuestion,
  patch: Record<string, unknown>,
): SurveyQuestion | string {
  const patchType = typeof patch["type"] === "string" ? (patch["type"] as SurveyQuestion["type"]) : undefined;
  let base: Record<string, unknown>;
  if (patchType && patchType !== current.type) {
    const retargeted = retargetQuestionType(current, patchType) as Record<string, unknown>;
    // 跨族换题型不携带旧载荷：retarget 只保留了公共字段，patch 必须给全新载荷。
    base = retargeted;
    base["type"] = patchType;
  } else {
    base = { ...current };
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id") continue;
    if (key === "type") continue;
    if (key === "showIf") {
      if (value === null) delete base["showIf"];
      else base["showIf"] = value;
      continue;
    }
    base[key] = value;
  }
  const parsed = SurveyQuestionSchema.safeParse(base);
  return parsed.success ? parsed.data : firstSchemaReason(parsed.error);
}

// ── 单操作应用 ───────────────────────────────────────────────────────────

type OpApplication =
  | { ok: true; definition: SurveyDefinition; op: SurveyOp }
  | { ok: false; reason: string };

function applyOp(
  definition: SurveyDefinition,
  op: SurveyOp,
  genId: (prefix: string) => string,
): OpApplication {
  switch (op.op) {
    case "set_meta": {
      const { researchDesign, ...rest } = op;
      const next: SurveyDefinition = {
        ...definition,
        ...(rest.title !== undefined ? { title: rest.title } : {}),
        ...(rest.description !== undefined ? { description: rest.description } : {}),
        ...(rest.consent !== undefined ? { consent: rest.consent } : {}),
      };
      if (researchDesign === null) delete next.researchDesign;
      else if (researchDesign !== undefined) next.researchDesign = researchDesign;
      return { ok: true, op, definition: next };
    }
    case "add_page": {
      if (op.afterPageId !== undefined && !definition.pages.some((page) => page.id === op.afterPageId)) {
        return { ok: false, reason: `afterPageId 不存在：${op.afterPageId}` };
      }
      const pageId = op.pageId ?? genId("p");
      if (definition.pages.some((page) => page.id === pageId)) {
        return { ok: false, reason: `页 id 已存在：${pageId}` };
      }
      const page: SurveyPage = {
        id: pageId,
        title: op.title,
        questionIds: [],
        ...(op.description !== undefined && op.description !== "" ? { description: op.description } : {}),
      };
      const pages = [...definition.pages];
      const at = op.afterPageId === undefined ? pages.length : pages.findIndex((page) => page.id === op.afterPageId) + 1;
      pages.splice(at, 0, page);
      return { ok: true, op: { ...op, pageId }, definition: { ...definition, pages } };
    }
    case "update_page": {
      const index = definition.pages.findIndex((page) => page.id === op.pageId);
      if (index === -1) return { ok: false, reason: `页不存在：${op.pageId}` };
      const next: SurveyPage = { ...definition.pages[index]! };
      if (op.title !== undefined) next.title = op.title;
      // 空串 = 清除页说明（description 是可选字段）。
      if (op.description !== undefined) {
        if (op.description === "") delete next.description;
        else next.description = op.description;
      }
      const pages = [...definition.pages];
      pages[index] = next;
      return { ok: true, op, definition: { ...definition, pages } };
    }
    case "remove_page": {
      const index = definition.pages.findIndex((page) => page.id === op.pageId);
      if (index === -1) return { ok: false, reason: `页不存在：${op.pageId}` };
      if (definition.pages.length <= 1) {
        return { ok: false, reason: "至少需要保留一页，最后一页不可删除" };
      }
      const target = definition.pages[index]!;
      const neighbor = definition.pages[index + 1] ?? definition.pages[index - 1]!;
      const pages = definition.pages
        .filter((page) => page.id !== op.pageId)
        .map((page) => {
          if (page.id !== neighbor.id) return page;
          return { ...page, questionIds: [...page.questionIds, ...target.questionIds] };
        })
        .map((page) => {
          if (page.jump?.targetPageId !== op.pageId) return page;
          const rest = { ...page };
          delete rest.jump;
          return rest;
        });
      return { ok: true, op, definition: withPages(definition, pages) };
    }
    case "add_question": {
      const pageIndex = definition.pages.findIndex((page) => page.id === op.pageId);
      if (pageIndex === -1) return { ok: false, reason: `页不存在：${op.pageId}` };
      const normalized = normalizeQuestionIds(op.question, genId);
      const parsed = SurveyQuestionSchema.safeParse(normalized);
      if (!parsed.success) return { ok: false, reason: `题目载荷不合法：${firstSchemaReason(parsed.error)}` };
      const question = parsed.data;
      if (questionOf(definition, question.id)) {
        return { ok: false, reason: `题目 id 已存在：${question.id}` };
      }
      if (question.type === "statement" && question.required) {
        return { ok: false, reason: "说明块不是题目，required 必须为 false" };
      }
      const targetPage = definition.pages[pageIndex]!;
      const at = Math.max(0, Math.min(op.index ?? targetPage.questionIds.length, targetPage.questionIds.length));
      const pages = definition.pages.map((page) =>
        page.id === op.pageId
          ? {
              ...page,
              questionIds: [
                ...page.questionIds.slice(0, at),
                question.id,
                ...page.questionIds.slice(at),
              ],
            }
          : page,
      );
      const source = { ...definition, pages, questions: [...definition.questions, question] };
      return {
        ok: true,
        op: { ...op, question: question as unknown as Record<string, unknown> },
        definition: { ...source, questions: rebuildQuestions(source) },
      };
    }
    case "update_question": {
      const index = definition.questions.findIndex((question) => question.id === op.questionId);
      if (index === -1) return { ok: false, reason: `题目不存在：${op.questionId}` };
      const merged = mergeQuestionPatch(definition.questions[index]!, op.patch);
      if (typeof merged === "string") return { ok: false, reason: `题目修改不合法：${merged}` };
      const questions = [...definition.questions];
      questions[index] = merged;
      return { ok: true, op, definition: { ...definition, questions } };
    }
    case "remove_question": {
      if (!questionOf(definition, op.questionId)) {
        return { ok: false, reason: `题目不存在：${op.questionId}` };
      }
      const pages = definition.pages.map((page) => {
        const next: SurveyPage = {
          ...page,
          questionIds: page.questionIds.filter((id) => id !== op.questionId),
        };
        if (next.jump?.when.questionId === op.questionId) delete next.jump;
        return next;
      });
      // 研究设计里的题目映射同步摘掉被删题：留下悬空 id 会假装该维度仍被测量。
      // 只动映射，不改研究问题/维度定义——目标本身不由工具替用户重写。
      const researchDesign = definition.researchDesign
        ? {
            ...definition.researchDesign,
            constructs: definition.researchDesign.constructs.map((construct) => ({
              ...construct,
              questionIds: construct.questionIds.filter((id) => id !== op.questionId),
            })),
          }
        : undefined;
      return {
        ok: true,
        definition: {
          ...definition,
          ...(researchDesign ? { researchDesign } : {}),
          pages,
          questions: definition.questions
            .filter((question) => question.id !== op.questionId)
            .map((question) => {
              if (question.showIf?.questionId !== op.questionId) return question;
              const rest = { ...question };
              delete rest.showIf;
              return rest;
            }),
        },
        op,
      };
    }
    case "move_question": {
      if (!questionOf(definition, op.questionId)) {
        return { ok: false, reason: `题目不存在：${op.questionId}` };
      }
      const target = definition.pages.find((page) => page.id === op.toPageId);
      if (!target) return { ok: false, reason: `目标页不存在：${op.toPageId}` };
      const fromPage = pageOf(definition, op.questionId);
      const pages = definition.pages.map((page) => ({
        ...page,
        questionIds: page.questionIds.filter((id) => id !== op.questionId),
      }));
      // 同页向下移动：先移除使原 index 左移一位；clamp 用移除前的长度。
      const originalLength = target.questionIds.length;
      let at = Math.max(0, Math.min(op.index, originalLength));
      if (fromPage && fromPage.id === op.toPageId) {
        const from = fromPage.questionIds.indexOf(op.questionId);
        if (from !== -1 && from < op.index) at = Math.max(0, at - 1);
      }
      const moved = pages.map((page) =>
        page.id === op.toPageId
          ? {
              ...page,
              questionIds: [...page.questionIds.slice(0, at), op.questionId, ...page.questionIds.slice(at)],
            }
          : page,
      );
      return { ok: true, op, definition: withPages(definition, moved) };
    }
    case "set_page_jump": {
      const index = definition.pages.findIndex((page) => page.id === op.pageId);
      if (index === -1) return { ok: false, reason: `页不存在：${op.pageId}` };
      if (op.jump && !definition.pages.some((page) => page.id === op.jump!.targetPageId)) {
        return { ok: false, reason: `跳页目标不存在：${op.jump.targetPageId}` };
      }
      const current = definition.pages[index]!;
      const next: SurveyPage = { ...current };
      if (op.jump) next.jump = op.jump;
      else delete next.jump;
      const pages = [...definition.pages];
      pages[index] = next;
      return { ok: true, op, definition: { ...definition, pages } };
    }
    case "replace_all": {
      return { ok: true, op, definition: op.definition };
    }
  }
}

/**
 * 在 definition 上按序应用一批操作。单个操作失败只拒绝该操作（reason 带回），
 * 不影响后续操作；每个成功操作后整体过 SurveyDefinitionSchema，形状不合法的
 * 变更在该操作处被拒——返回的 definition 恒为形状合法。
 */
export function applySurveyOps(
  definition: SurveyDefinition,
  ops: readonly unknown[],
  options: SurveyOpsOptions = {},
): SurveyOpsResult {
  const genId = options.genId ?? defaultId;
  const applied: SurveyOp[] = [];
  const rejected: SurveyOpRejection[] = [];
  let current = definition;
  for (const raw of ops) {
    const parsed = SurveyOpSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ op: raw, reason: `操作不合法：${firstSchemaReason(parsed.error)}` });
      continue;
    }
    const outcome = applyOp(current, parsed.data, genId);
    if (!outcome.ok) {
      rejected.push({ op: raw, reason: outcome.reason });
      continue;
    }
    const shape = SurveyDefinitionSchema.safeParse(outcome.definition);
    if (!shape.success) {
      rejected.push({ op: raw, reason: `应用后定义不合法：${firstSchemaReason(shape.error)}` });
      continue;
    }
    // 只验不替换：zod parse 会整体重建对象，破坏 clone-on-write 的引用共享
    // （历史栈与 Vue 响应式依赖未改动路径的引用不变）。
    current = outcome.definition;
    applied.push(outcome.op);
  }
  return {
    definition: current,
    applied,
    rejected,
    issues: [...validateSurveyDefinition(current), ...validateSurveyDesign(current)],
  };
}
