import { describe, expect, it } from "vitest";

import type { SurveyDefinition } from "./definition.js";
import { applySurveyOps } from "./ops.js";
import {
  applySurveyReviewPlan,
  buildSurveyReviewPlan,
  SURVEY_REVIEW_PLAN_MAX_GROUPS,
  type SurveyReviewPlanFinding,
} from "./review-plan.js";
import { makeDefinition } from "./test-fixtures.js";

function finding(
  id: string,
  overrides: Partial<SurveyReviewPlanFinding> = {},
): SurveyReviewPlanFinding {
  return {
    id,
    title: `问题 ${id}`,
    severity: "major",
    reason: "依据",
    recommendation: "建议",
    ...overrides,
  };
}

const retitle = (questionId: string, title: string) => ({
  op: "update_question" as const,
  questionId,
  patch: { title },
});

describe("buildSurveyReviewPlan — 共同原因与优先级", () => {
  it("同一 checkId 的多条发现合并成一组，保持 finding 原序", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q1", "新题一")] }),
      finding("f2", { checkId: "wording.double_barrel", suggestedOps: [retitle("q2", "新题二")] }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      id: "check:wording.double_barrel",
      checkId: "wording.double_barrel",
      findingIds: ["f1", "f2"],
    });
    expect(plan.groups[0]?.ops.map((op) => op.op)).toEqual(["update_question", "update_question"]);
    expect(plan.ops).toHaveLength(2);
  });

  it("同组内完全相同的操作只保留一次", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "options.missing_exclusive", suggestedOps: [retitle("q2", "同一改法")] }),
      finding("f2", { checkId: "options.missing_exclusive", suggestedOps: [retitle("q2", "同一改法")] }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.findingIds).toEqual(["f1", "f2"]);
    expect(plan.groups[0]?.ops).toHaveLength(1);
    expect(plan.ops).toHaveLength(1);
  });

  it("blocker > major > minor，同级别保持原序", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("m1", { checkId: "wording.vague", severity: "minor", suggestedOps: [retitle("q3", "m1")] }),
      finding("a1", { checkId: "wording.double_barrel", severity: "major", suggestedOps: [retitle("q4", "a1")] }),
      finding("b1", { checkId: "flow.missing_eligibility", severity: "blocker", suggestedOps: [retitle("q5", "b1")] }),
      finding("a2", { checkId: "options.overlap", severity: "major", suggestedOps: [retitle("q2", "a2")] }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.groups.map((group) => group.id)).toEqual([
      "check:flow.missing_eligibility",
      "check:wording.double_barrel",
      "check:options.overlap",
    ]);
    expect(plan.groups.map((group) => group.severity)).toEqual(["blocker", "major", "major"]);
  });

  it("组级别取组内最高级别", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "wording.double_barrel", severity: "minor", suggestedOps: [retitle("q1", "f1")] }),
      finding("f2", { checkId: "wording.double_barrel", severity: "major", suggestedOps: [retitle("q2", "f2")] }),
    ]);

    expect(plan.groups[0]?.severity).toBe("major");
  });

  it("最多 3 组，超出的可自动修复发现进 deferred", () => {
    const plan = buildSurveyReviewPlan(
      makeDefinition(),
      ["q1", "q2", "q3", "q4"].map((questionId, index) =>
        finding(`f${index + 1}`, {
          checkId: `check.${index + 1}`,
          severity: index === 3 ? "minor" : "major",
          suggestedOps: [retitle(questionId, `改${index + 1}`)],
        }),
      ),
    );

    expect(plan.status).toBe("ready");
    expect(plan.groups).toHaveLength(SURVEY_REVIEW_PLAN_MAX_GROUPS);
    expect(plan.groups.map((group) => group.id)).toEqual(["check:check.1", "check:check.2", "check:check.3"]);
    expect(plan.deferred).toHaveLength(1);
    expect(plan.deferred[0]?.findingId).toBe("f4");
    expect(plan.ops).toHaveLength(3);
  });

  it("目录外发现（无 checkId）不编造共同标准，单条成组", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { suggestedOps: [retitle("q1", "f1")] }),
      finding("f2", { suggestedOps: [retitle("q2", "f2")] }),
      finding("f3", { checkId: "wording.double_barrel", suggestedOps: [retitle("q3", "f3")] }),
    ]);

    expect(plan.groups.map((group) => group.id)).toEqual(["finding:f1", "finding:f2", "check:wording.double_barrel"]);
    expect(plan.groups[0]?.checkId).toBeUndefined();
    expect(plan.groups[0]?.findingIds).toEqual(["f1"]);
  });
});

describe("buildSurveyReviewPlan — 候选定义与原子性", () => {
  it("不修改原定义，候选定义是同一基线的新对象", () => {
    const definition = makeDefinition();
    const snapshot = structuredClone(definition);

    const plan = buildSurveyReviewPlan(definition, [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q2", "新多选")] }),
    ]);

    expect(definition).toEqual(snapshot);
    expect(plan.candidateDefinition).not.toBe(definition);
    expect(plan.candidateDefinition?.questions.find((question) => question.id === "q2")?.title).toBe("新多选");
  });

  it("候选定义就是整批合并操作的结果，可直接整批应用", () => {
    const definition = makeDefinition();
    const plan = buildSurveyReviewPlan(definition, [
      finding("f1", {
        checkId: "wording.double_barrel",
        suggestedOps: [retitle("q1", "拆题一"), retitle("q2", "拆题二")],
      }),
      finding("f2", { checkId: "options.missing_exclusive", suggestedOps: [retitle("q3", "补选项")] }),
    ]);

    expect(plan.status).toBe("ready");
    const replay = applySurveyOps(definition, plan.ops);
    expect(replay.rejected).toEqual([]);
    expect(replay.definition).toEqual(plan.candidateDefinition);

    const applied = applySurveyReviewPlan(definition, plan);
    expect(applied.ok).toBe(true);
    expect(applied.definition).toEqual(plan.candidateDefinition);
  });

  it("跨发现改写同一字段 → 整批 block，候选定义为空", () => {
    const definition = makeDefinition();
    const plan = buildSurveyReviewPlan(definition, [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q2", "改法甲")] }),
      finding("f2", { checkId: "wording.leading", suggestedOps: [retitle("q2", "改法乙")] }),
    ]);

    expect(plan.status).toBe("blocked");
    expect(plan.candidateDefinition).toBeNull();
    expect(plan.issues).toEqual([]);
    expect(plan.rejections).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.target).toBe("question:q2.title");
    expect(applySurveyReviewPlan(definition, plan)).toEqual({ ok: false, issues: [], rejections: [] });
  });

  it("同题不同字段不算冲突", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q1", "改题")] }),
      finding("f2", { checkId: "wording.missing_required", suggestedOps: [{ op: "update_question", questionId: "q1", patch: { required: false } }] }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.conflicts).toEqual([]);
    expect(plan.candidateDefinition?.questions.find((question) => question.id === "q1")).toMatchObject({
      title: "改题",
      required: false,
    });
  });

  it("任一操作被拒 → 整批不可应用，不返回部分结果", () => {
    const definition = makeDefinition();
    const plan = buildSurveyReviewPlan(definition, [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q1", "可改")] }),
      finding("f2", { checkId: "flow.dead_end", suggestedOps: [retitle("ghost", "不存在")] }),
    ]);

    expect(plan.status).toBe("blocked");
    expect(plan.candidateDefinition).toBeNull();
    expect(plan.rejections).toHaveLength(1);
    expect(plan.rejections[0]?.reason).toContain("ghost");

    const applied = applySurveyReviewPlan(definition, plan);
    expect(applied.ok).toBe(false);
    expect(applied.definition).toBeUndefined();
  });

  it("同一发现内的顺序脚本（先加页再加题）不算冲突", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", {
        checkId: "coverage.missing_open_ended",
        suggestedOps: [
          { op: "add_page", title: "四", pageId: "p4" },
          { op: "add_question", pageId: "p4", question: { id: "q6", type: "text", title: "补充", required: false } },
        ],
      }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.conflicts).toEqual([]);
    expect(plan.candidateDefinition?.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("基线在计划生成后漂移 → 重放整批失败", () => {
    const definition = makeDefinition();
    const plan = buildSurveyReviewPlan(definition, [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q1", "改题")] }),
    ]);
    const drifted = applySurveyOps(definition, [{ op: "remove_question", questionId: "q1" }]).definition;

    const applied = applySurveyReviewPlan(drifted, plan);
    expect(applied.ok).toBe(false);
    expect(applied.definition).toBeUndefined();
    expect(applied.rejections).toHaveLength(1);
  });
});

describe("buildSurveyReviewPlan — 人工项与空输入", () => {
  it("无 suggestedOps 的发现只进人工清单，不伪装成可修复", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "analysis.missing_plan" }),
      finding("f2", { checkId: "sampling.convenience", suggestedOps: [] }),
    ]);

    expect(plan.status).toBe("manual-only");
    expect(plan.groups).toEqual([]);
    expect(plan.ops).toEqual([]);
    expect(plan.candidateDefinition).toBeNull();
    expect(plan.deferred).toEqual([]);
    expect(plan.manual.map((item) => item.findingId)).toEqual(["f1", "f2"]);
    expect(plan.manual[0]).toMatchObject({ checkId: "analysis.missing_plan", recommendation: "建议" });
    expect(applySurveyReviewPlan(makeDefinition(), plan).ok).toBe(false);
  });

  it("人工项按级别排序，同级别保持原序", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("m1", { severity: "minor" }),
      finding("b1", { severity: "blocker" }),
      finding("m2", { severity: "minor" }),
    ]);

    expect(plan.manual.map((item) => item.findingId)).toEqual(["b1", "m1", "m2"]);
  });

  it("空输入返回空计划", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), []);

    expect(plan).toMatchObject({
      status: "empty",
      groups: [],
      ops: [],
      candidateDefinition: null,
      issues: [],
      manual: [],
      deferred: [],
      rejections: [],
      conflicts: [],
    });
  });

  it("可修复发现同时保留人工项", () => {
    const plan = buildSurveyReviewPlan(makeDefinition(), [
      finding("f1", { checkId: "wording.double_barrel", suggestedOps: [retitle("q1", "改题")] }),
      finding("f2", { checkId: "sampling.convenience" }),
    ]);

    expect(plan.status).toBe("ready");
    expect(plan.groups).toHaveLength(1);
    expect(plan.manual.map((item) => item.findingId)).toEqual(["f2"]);
  });
});
