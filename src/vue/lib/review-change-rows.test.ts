// 候选改动 before/after 行投影单测（M2 评审①）：从原研究面板 changeRows 提炼
// 后的关键语义回归——真实差异才成行、同值异序不冒充修改、meta/researchDesign/
// 顺序变化可核对。
import { describe, expect, it } from "vitest";
import { buildSurveyReviewPlan } from "../../core/index.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import { reviewChangeRows, reviewQuestionLabel } from "./review-change-rows.js";

const t = (key: string, params?: Record<string, unknown>) => {
  const zh: Record<string, string> = {
    "surveys.questionTitle": "题干",
    "surveys.questionType": "题型",
    "surveys.assistant.position": "题目顺序",
    "surveys.assistant.unmapped": "映射待更新",
    "surveys.assistant.questionIndex": "第 {n} 题",
    "surveys.assistant.unchangedValue": "未设置",
    "surveys.assistant.yes": "是",
    "surveys.assistant.no": "否",
    "surveys.assistant.conditionSummary": "{question} 的答案为 {value} 时显示",
    "surveys.showCondition": "仅在前题满足条件时显示",
    "surveys.assistant.analysis": "预期分析",
    "surveys.title": "问卷名称",
  };
  return (zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
};

type Review = Extract<ToolSurveyDelivery, { type: "survey_review" }>;

function context(overrides: Partial<Review> = {}) {
  const original = makeDefinition();
  const report: Review = {
    type: "survey_review", surveyId: "s1", operationId: "op-1", baseDraftVersion: 1, summary: "澄清",
    findings: [{
      id: "f1", checkId: "wording.timeframe", questionId: "q1", title: "时间范围", severity: "major",
      reason: "缺少时间范围", recommendation: "说明过去一学期",
      suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一学期的使用情况" } }],
    }],
    ...overrides,
  };
  const candidate = buildSurveyReviewPlan(original, report.findings).candidateDefinition!;
  return { original, candidate, findings: report.findings, t };
}

function singleRow(overrides: Partial<Review> = {}) {
  const ctx = context(overrides);
  const plan = buildSurveyReviewPlan(ctx.original, ctx.findings);
  const rows = reviewChangeRows(plan.groups[0]!, ctx);
  expect(rows.length).toBeGreaterThan(0);
  return { ctx, plan, rows };
}

describe("review-change-rows（诊断条候选项核对）", () => {
  it("题目字段修改展示真实前后，不做盲投影", () => {
    const { rows } = singleRow();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.field).toBe("题干");
    expect(rows[0]!.before).toBe("单选");
    expect(rows[0]!.after).toBe("过去一学期的使用情况");
  });

  it("同值异序的显示条件不因字段顺序变化而冒充修改", () => {
    const ctx = context();
    ctx.original.questions[2] = {
      ...ctx.original.questions[2]!,
      showIf: { value: "a", op: "eq" as const, questionId: "q1" },
    };
    const reordered: Review = {
      type: "survey_review", surveyId: "s1", operationId: "op-2", baseDraftVersion: 1, summary: "澄清",
      findings: [{
        ...ctx.findings[0]!, id: "f2", questionId: "q3",
        suggestedOps: [{ op: "update_question", questionId: "q3", patch: { title: "澄清后的文本题" } }],
      }],
    };
    ctx.findings = reordered.findings;
    ctx.candidate = buildSurveyReviewPlan(ctx.original, reordered.findings).candidateDefinition!;
    const rows = reviewChangeRows(buildSurveyReviewPlan(ctx.original, reordered.findings).groups[0]!, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toBe("澄清后的文本题");
    expect(rows.some((row) => row.field.includes("仅在前题满足条件时显示"))).toBe(false);
  });

  it("researchDesign 与卷级 meta 的修改可核对（title/description/consent/设计字段）", () => {
    const ctx = context({
      findings: [{
        id: "f-meta", questionId: undefined, title: "补设计", severity: "major",
        reason: "缺少研究依据", recommendation: "补充分析计划",
        suggestedOps: [{
          op: "set_meta", title: "新标题", consent: "知情同意文本",
          researchDesign: {
            researchQuestion: "使用情况", population: "研究生", recruitment: "自愿招募", purpose: "describe",
            timeBudgetMinutes: 5, constructs: [], analysisPlan: "逐题报告有效数与缺失数", assumptions: [], pendingDecisions: [],
          },
        }],
      }],
    });
    const plan = buildSurveyReviewPlan(ctx.original, ctx.findings);
    const rows = reviewChangeRows(plan.groups[0]!, ctx);
    const fields = rows.map((row) => row.field);
    expect(fields).toContain("问卷名称");
    expect(fields).toContain("预期分析");
    const analysis = rows.find((row) => row.field === "预期分析")!;
    expect(analysis.before).toBe("未设置");
    expect(analysis.after).toBe("逐题报告有效数与缺失数");
    // 未变化的 description/researchQuestion（原值相同）不成行。
    expect(fields).not.toContain("研究说明");
  });

  it("题目顺序变化成行，题号定位可核对", () => {
    const original = makeDefinition();
    const candidate = { ...original, questions: [...original.questions].reverse() };
    const group = {
      id: "check:flow.order", severity: "minor" as const, title: "调序", findingIds: ["f-move"],
      ops: [{ op: "move_question" as const, questionId: original.questions[0]!.id, toPageId: "p1", index: 0 }],
    };
    const rows = reviewChangeRows(group, { original, candidate, findings: [], t });
    const positionRows = rows.filter((row) => row.field === "题目顺序");
    expect(positionRows.length).toBeGreaterThan(0);
    expect(positionRows[0]!.before).not.toBe(positionRows[0]!.after);
    expect(positionRows[0]!.location).toContain("第 1 题");
  });

  it("题号解析先原卷后候选；两边都没有才报映射待更新", () => {
    const ctx = context();
    expect(reviewQuestionLabel("q1", ctx)).toBe("第 1 题");
    expect(reviewQuestionLabel("q-missing", ctx)).toBe("映射待更新");
  });
});
