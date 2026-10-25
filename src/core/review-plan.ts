// 「帮我完善」的修订计划（issue #224）：把 survey_review 发现按共同原因（checkId）
// 合并成最多 3 组优先修订，并从同一草稿基线算出完整候选定义。纯函数、不改入参、
// 不抛错；任何操作冲突或被拒即整批不可应用，绝不返回部分结果。
import type {
  SurveyDefinition,
  SurveyIssue,
  SurveyReviewSeverity,
} from "./definition.js";
import { applySurveyOps, type SurveyOp, type SurveyOpRejection } from "./ops.js";

/** 默认只呈现最重要的几组；超出的可自动修复发现进 deferred，不静默丢弃。 */
export const SURVEY_REVIEW_PLAN_MAX_GROUPS = 3;

const SEVERITY_RANK: Record<SurveyReviewSeverity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
};

const rankOf = (severity: SurveyReviewSeverity): number => SEVERITY_RANK[severity] ?? 3;

/**
 * 计划输入：SurveyReviewFinding 的结构子集。core 不反向依赖 contracts，也不重复
 * 校验形状——findings 在 survey_review 登记时已过契约校验。
 */
export interface SurveyReviewPlanFinding {
  id: string;
  checkId?: string;
  title: string;
  severity: SurveyReviewSeverity;
  reason: string;
  recommendation: string;
  suggestedOps?: readonly SurveyOp[];
}

export interface SurveyReviewPlanGroup {
  /** 稳定组 id：`check:<checkId>`，目录外发现为 `finding:<findingId>`。 */
  id: string;
  /** 共同原因：命中的 checkId；目录外发现没有，单条自成一组。 */
  checkId?: string;
  /** 组内最高级别（blocker > major > minor）。 */
  severity: SurveyReviewSeverity;
  /** 组标题取组内首条发现（同级别保持 discover 原序）。 */
  title: string;
  findingIds: string[];
  /**
   * 组内合并后的操作：按 finding 原序、finding 内原序展开，完全相同的操作去重。
   * ready 时已换成 applySurveyOps 归一后的形态（含生成的 id），可直接重放。
   */
  ops: SurveyOp[];
}

/** 无法自动修复、必须由人判断或补素材的发现。 */
export interface SurveyReviewPlanManualItem {
  findingId: string;
  checkId?: string;
  title: string;
  severity: SurveyReviewSeverity;
  reason: string;
  recommendation: string;
}

/** 有可自动修复的操作，但本次没进前 3 组（留给下一轮或单条处理）。 */
export interface SurveyReviewPlanDeferred {
  findingId: string;
  checkId?: string;
  title: string;
  severity: SurveyReviewSeverity;
}

/** 两条发现改写同一对象的同一字段：无先后语义，合并会静默丢弃一方。 */
export interface SurveyReviewPlanConflict {
  /** 冲突双方（按 finding 原序）。 */
  findingIds: [string, string];
  /** 冲突目标，如 `question:q2.title`、`page:p1.*`、`整卷定义`。 */
  target: string;
  reason: string;
}

export type SurveyReviewPlanStatus =
  | "empty"
  | "manual-only"
  | "blocked"
  | "ready";

export interface SurveyReviewPlan {
  status: SurveyReviewPlanStatus;
  /** 按优先级排好的组，最多 SURVEY_REVIEW_PLAN_MAX_GROUPS 组（blocked 时也保留）。 */
  groups: SurveyReviewPlanGroup[];
  /** 全部组的操作按组序展开；整批一起应用，没有「应用前两组」这种中间态。 */
  ops: SurveyOp[];
  /** 只由 status === "ready" 时给出；其余一律 null（不返回部分应用结果）。 */
  candidateDefinition: SurveyDefinition | null;
  /** 候选定义（或已应用结果）的语义校验，如空页、条件不可达。 */
  issues: SurveyIssue[];
  manual: SurveyReviewPlanManualItem[];
  deferred: SurveyReviewPlanDeferred[];
  rejections: SurveyOpRejection[];
  conflicts: SurveyReviewPlanConflict[];
}

export interface SurveyReviewPlanOptions {
  /** 缺 id 操作的 id 生成器；缺省确定性序号，同基线同输入产出同一候选。 */
  genId?: (prefix: string) => string;
}

export interface SurveyReviewPlanApplication {
  ok: boolean;
  /** 只在 ok 时给出：失败绝不返回部分应用的定义。 */
  definition?: SurveyDefinition;
  issues: SurveyIssue[];
  rejections: SurveyOpRejection[];
}

interface PlanOpEntry {
  findingId: string;
  op: SurveyOp;
}

interface CauseDraft {
  id: string;
  checkId?: string;
  members: Array<{ index: number; finding: SurveyReviewPlanFinding }>;
}

interface OrderedCause extends CauseDraft {
  severity: SurveyReviewSeverity;
  firstIndex: number;
}

interface GroupDraft {
  cause: OrderedCause;
  ops: SurveyOp[];
}

// ── 内部工具 ─────────────────────────────────────────────────────────────

function deterministicGenId(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}rp${next}`;
  };
}

/** 键序无关的稳定序列化：跨发现判「是不是同一条操作」用。 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

interface OpEffect {
  /** 受影响对象；`*` = 整卷。 */
  identity: string;
  /** 写入的字段；`*` = 独占该对象（新建/删除/换题型/整卷替换）。 */
  fields: string[];
}

function opEffect(op: SurveyOp, index: number): OpEffect {
  switch (op.op) {
    case "set_meta": {
      const fields: string[] = [];
      if (op.title !== undefined) fields.push("title");
      if (op.description !== undefined) fields.push("description");
      if (op.consent !== undefined) fields.push("consent");
      if (op.researchDesign !== undefined) fields.push("researchDesign");
      return { identity: "meta", fields };
    }
    case "add_page":
      return { identity: op.pageId ? `page:${op.pageId}` : `page:new#${index}`, fields: ["*"] };
    case "update_page": {
      const fields: string[] = [];
      if (op.title !== undefined) fields.push("title");
      if (op.description !== undefined) fields.push("description");
      return { identity: `page:${op.pageId}`, fields };
    }
    case "remove_page":
      return { identity: `page:${op.pageId}`, fields: ["*"] };
    case "add_question": {
      const id = op.question["id"];
      return {
        identity: typeof id === "string" && id ? `question:${id}` : `question:new#${index}`,
        fields: ["*"],
      };
    }
    case "update_question": {
      // 换题型会重建载荷（retargetQuestionType），与同题其他写入互斥。
      const keys = Object.keys(op.patch).filter((key) => key !== "id");
      return {
        identity: `question:${op.questionId}`,
        fields: keys.includes("type") ? ["*"] : keys,
      };
    }
    case "remove_question":
      return { identity: `question:${op.questionId}`, fields: ["*"] };
    case "move_question":
      return { identity: `question:${op.questionId}`, fields: ["position"] };
    case "set_page_jump":
      return { identity: `page:${op.pageId}`, fields: ["jump"] };
    case "replace_all":
      return { identity: "*", fields: ["*"] };
  }
}

const fieldsOverlap = (left: readonly string[], right: readonly string[]): boolean =>
  left.includes("*") || right.includes("*") || left.some((field) => right.includes(field));

const describeTarget = (effect: OpEffect): string => {
  if (effect.identity === "*") return "整卷定义";
  if (effect.fields.includes("*")) return `${effect.identity}.*`;
  return `${effect.identity}.${effect.fields.join("|")}`;
};

function scanConflicts(entries: readonly PlanOpEntry[]): SurveyReviewPlanConflict[] {
  const effects = entries.map((entry, index) => ({ entry, effect: opEffect(entry.op, index) }));
  const conflicts: SurveyReviewPlanConflict[] = [];
  for (let i = 0; i < effects.length; i += 1) {
    for (let j = i + 1; j < effects.length; j += 1) {
      const left = effects[i]!;
      const right = effects[j]!;
      // 同一发现内的多步操作是作者给的顺序脚本（先加页再改动），不算冲突。
      if (left.entry.findingId === right.entry.findingId) continue;
      const bothTargeted = left.effect.identity === right.effect.identity;
      if (!bothTargeted && left.effect.identity !== "*" && right.effect.identity !== "*") continue;
      if (!fieldsOverlap(left.effect.fields, right.effect.fields)) continue;
      // 完全相同的操作合并后只应用一次，不是冲突。
      if (stableKey(left.entry.op) === stableKey(right.entry.op)) continue;
      const target = describeTarget(left.effect.identity === "*" ? right.effect : left.effect);
      conflicts.push({
        findingIds: [left.entry.findingId, right.entry.findingId],
        target,
        reason: `两条发现都改写 ${target}，无法自动合并`,
      });
    }
  }
  return conflicts;
}

function describeGroups(
  drafts: readonly GroupDraft[],
  applied?: readonly SurveyOp[],
): SurveyReviewPlanGroup[] {
  let cursor = 0;
  return drafts.map((draft) => ({
    id: draft.cause.id,
    checkId: draft.cause.checkId,
    severity: draft.cause.severity,
    title: draft.cause.members[0]!.finding.title,
    findingIds: draft.cause.members.map((member) => member.finding.id),
    ops: applied ? draft.ops.map(() => applied[cursor++]!) : draft.ops,
  }));
}

// ── 计划构建 ─────────────────────────────────────────────────────────────

/**
 * 从当前定义与 survey_review findings 生成修订计划。
 *
 * 分组只用 checkId 作为共同原因；目录外发现（无 checkId）不编造共同标准，单条成组。
 * 组序按 blocker > major > minor，同级别保持 findings 原序，超过 3 组的进 deferred。
 * 合并后的整批操作在同一基线上一次性应用：任一操作被拒或跨发现冲突 → blocked，
 * candidateDefinition 为 null。
 */
export function buildSurveyReviewPlan(
  definition: SurveyDefinition,
  findings: readonly SurveyReviewPlanFinding[],
  options: SurveyReviewPlanOptions = {},
): SurveyReviewPlan {
  const genId = options.genId ?? deterministicGenId();
  const manual: Array<{ index: number; item: SurveyReviewPlanManualItem }> = [];
  const causes = new Map<string, CauseDraft>();

  findings.forEach((finding, index) => {
    const ops = finding.suggestedOps ?? [];
    if (ops.length === 0) {
      manual.push({
        index,
        item: {
          findingId: finding.id,
          checkId: finding.checkId,
          title: finding.title,
          severity: finding.severity,
          reason: finding.reason,
          recommendation: finding.recommendation,
        },
      });
      return;
    }
    const key = finding.checkId ? `check:${finding.checkId}` : `finding:${finding.id}`;
    const draft = causes.get(key) ?? { id: key, checkId: finding.checkId, members: [] };
    draft.members.push({ index, finding });
    causes.set(key, draft);
  });

  const ordered: OrderedCause[] = [...causes.values()]
    .map((cause) => ({
      ...cause,
      severity: cause.members.reduce<SurveyReviewSeverity>(
        (worst, member) =>
          rankOf(member.finding.severity) < rankOf(worst) ? member.finding.severity : worst,
        cause.members[0]!.finding.severity,
      ),
      firstIndex: cause.members[0]!.index,
    }))
    .sort((left, right) => rankOf(left.severity) - rankOf(right.severity) || left.firstIndex - right.firstIndex);

  const kept = ordered.slice(0, SURVEY_REVIEW_PLAN_MAX_GROUPS);
  const deferred: SurveyReviewPlanDeferred[] = ordered
    .slice(SURVEY_REVIEW_PLAN_MAX_GROUPS)
    .flatMap((cause) =>
      cause.members.map((member) => ({
        findingId: member.finding.id,
        checkId: member.finding.checkId,
        title: member.finding.title,
        severity: member.finding.severity,
      })),
    );
  const sortedManual = manual
    .sort(
      (left, right) =>
        rankOf(left.item.severity) - rankOf(right.item.severity) || left.index - right.index,
    )
    .map((entry) => entry.item);

  const entries: PlanOpEntry[] = [];
  const drafts: GroupDraft[] = kept.map((cause) => {
    const seen = new Set<string>();
    const ops: SurveyOp[] = [];
    for (const member of cause.members) {
      for (const op of member.finding.suggestedOps ?? []) {
        const key = stableKey(op);
        if (seen.has(key)) continue;
        seen.add(key);
        ops.push(op);
        entries.push({ findingId: member.finding.id, op });
      }
    }
    return { cause, ops };
  });
  const ops = entries.map((entry) => entry.op);

  if (ops.length === 0) {
    return {
      status: findings.length === 0 ? "empty" : "manual-only",
      groups: [],
      ops: [],
      candidateDefinition: null,
      issues: [],
      manual: sortedManual,
      deferred: [],
      rejections: [],
      conflicts: [],
    };
  }

  const conflicts = scanConflicts(entries);
  if (conflicts.length > 0) {
    return {
      status: "blocked",
      groups: describeGroups(drafts),
      ops,
      candidateDefinition: null,
      issues: [],
      manual: sortedManual,
      deferred,
      rejections: [],
      conflicts,
    };
  }

  const applied = applySurveyOps(definition, ops, { genId });
  if (applied.rejected.length > 0) {
    return {
      status: "blocked",
      groups: describeGroups(drafts),
      ops,
      candidateDefinition: null,
      issues: [],
      manual: sortedManual,
      deferred,
      rejections: applied.rejected,
      conflicts: [],
    };
  }

  return {
    status: "ready",
    groups: describeGroups(drafts, applied.applied),
    ops: applied.applied,
    candidateDefinition: applied.definition,
    issues: applied.issues,
    manual: sortedManual,
    deferred,
    rejections: [],
    conflicts: [],
  };
}

/**
 * 在给定基线上一次性重放计划的操作。只接受 status === "ready" 的计划；基线在
 * 计划生成后变过（题目被删、页被移除）时操作会被拒，此时整批失败、不返回部分结果。
 */
export function applySurveyReviewPlan(
  definition: SurveyDefinition,
  plan: SurveyReviewPlan,
  options: SurveyReviewPlanOptions = {},
): SurveyReviewPlanApplication {
  if (plan.status !== "ready" || plan.ops.length === 0) {
    return { ok: false, issues: [], rejections: [] };
  }
  const result = applySurveyOps(definition, plan.ops, options);
  if (result.rejected.length > 0) {
    return { ok: false, issues: [], rejections: result.rejected };
  }
  return { ok: true, definition: result.definition, issues: result.issues, rejections: [] };
}
