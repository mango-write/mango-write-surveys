// B1 校验文案映射：每个 issue code 都要有不带内部路径的人话文案。
// 直接用 validateSurveyDefinition 产 issue，钉住「真实 code → 真实文案」，
// 防止 validate-definition 加新 code 时这里静默漏进兜底。
import { describe, expect, it } from "vitest";

import {
  validateSurveyDefinition,
  type SurveyDefinition,
} from "../../core/index.js";

import { describeSurveyIssue } from "./issue-copy";
import { createSurveysTestI18n } from "../test-mount.js";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>): string =>
  params
    ? (i18n.global.t(key, params as never) as string)
    : (i18n.global.t(key) as string);

function base(): SurveyDefinition {
  return {
    version: 1,
    title: "问卷",
    description: "",
    consent: "",
    questions: [{ id: "q1", type: "text", title: "第一题", required: false }],
    pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
  };
}

function textOf(def: SurveyDefinition, code: string): string {
  const issue = validateSurveyDefinition(def).find((x) => x.code === code);
  expect(issue, `definition should produce issue ${code}`).toBeDefined();
  return describeSurveyIssue(def, issue!, t);
}

describe("describeSurveyIssue（issue #217 B1 文案映射）", () => {
  it("empty_page 指出页序，不带内部路径", () => {
    const def = base();
    def.pages.push({ id: "p2", title: "第二页", questionIds: [] });
    expect(textOf(def, "empty_page")).toBe(t("surveys.issue.emptyPage", { n: 2 }));
    expect(textOf(def, "empty_page")).not.toContain("pages.");
  });

  it("empty_options 指出题干", () => {
    const def = base();
    def.questions.push({ id: "q2", type: "single", title: "选择题", required: false, options: [] });
    expect(textOf(def, "empty_options")).toBe(
      t("surveys.issue.emptyOptions", { q: "选择题" }),
    );
  });

  it("duplicate_id 落到题作用域文案", () => {
    const def = base();
    def.questions.push({ id: "q1", type: "text", title: "重名题", required: false });
    expect(textOf(def, "duplicate_id")).toBe(
      t("surveys.issue.duplicateQuestionId", { q: "重名题" }),
    );
  });

  it("invalid_choice_range 按 min/max 两个方向区分文案", () => {
    const both = base();
    both.questions.push({
      id: "q2",
      type: "multiple",
      title: "多选题",
      required: false,
      options: [{ id: "o1", label: "甲" }, { id: "o2", label: "乙" }],
      minChoices: 3,
      maxChoices: 1,
    });
    expect(textOf(both, "invalid_choice_range")).toBe(
      t("surveys.issue.minChoicesExceedMax", { q: "多选题" }),
    );
    const exceed = base();
    exceed.questions.push({
      id: "q2",
      type: "multiple",
      title: "多选题",
      required: false,
      options: [{ id: "o1", label: "甲" }],
      maxChoices: 5,
    });
    expect(textOf(exceed, "invalid_choice_range")).toBe(
      t("surveys.issue.maxChoicesExceedOptions", { q: "多选题" }),
    );
  });

  it("invalid_number_range 与 invalid_scale_range 指出题干", () => {
    const def = base();
    def.questions.push(
      { id: "q2", type: "number", title: "数字题", required: false, min: 5, max: 1 },
      { id: "q3", type: "scale", title: "量表题", required: false, min: 5, max: 1 },
    );
    expect(textOf(def, "invalid_number_range")).toBe(
      t("surveys.issue.numberRange", { q: "数字题" }),
    );
    expect(textOf(def, "invalid_scale_range")).toBe(
      t("surveys.issue.scaleRange", { q: "量表题" }),
    );
  });

  it("condition_not_previous 按显示条件/跳页条件区分文案与定位", () => {
    const shown = base();
    shown.questions.push({ id: "q2", type: "text", title: "后题", required: false });
    shown.pages.push({ id: "p2", title: "第二页", questionIds: ["q2"] });
    shown.questions[0]!.showIf = { questionId: "q2", op: "eq", value: "x" };
    expect(textOf(shown, "condition_not_previous")).toBe(
      t("surveys.issue.conditionNotPrevious", { q: "第一题" }),
    );

    const jumped = base();
    jumped.questions.push({ id: "q2", type: "text", title: "后题", required: false });
    jumped.pages.push({ id: "p2", title: "第二页", questionIds: ["q2"] });
    jumped.pages[0]!.jump = {
      when: { questionId: "q2", op: "eq", value: "x" },
      targetPageId: "p2",
    };
    expect(textOf(jumped, "condition_not_previous")).toBe(
      t("surveys.issue.jumpConditionNotPrevious", { n: 1 }),
    );
  });

  it("condition_type_mismatch 与 condition_unknown_option 指出题干", () => {
    const def = base();
    def.questions[0] = {
      id: "q1",
      type: "single",
      title: "第一题",
      required: false,
      options: [{ id: "o1", label: "甲" }, { id: "o2", label: "乙" }],
    };
    def.questions.push({
      id: "q2",
      type: "text",
      title: "条件题",
      required: false,
      showIf: { questionId: "q1", op: "contains", value: "o1" },
    });
    def.pages[0]!.questionIds.push("q2");
    expect(textOf(def, "condition_type_mismatch")).toBe(
      t("surveys.issue.conditionTypeMismatch", { q: "条件题" }),
    );
    const unknownOption = base();
    unknownOption.questions[0] = {
      id: "q1",
      type: "single",
      title: "第一题",
      required: false,
      options: [{ id: "o1", label: "甲" }],
    };
    unknownOption.questions.push({
      id: "q2",
      type: "text",
      title: "条件题",
      required: false,
      showIf: { questionId: "q1", op: "eq", value: "ghost" },
    });
    unknownOption.pages[0]!.questionIds.push("q2");
    expect(textOf(unknownOption, "condition_unknown_option")).toBe(
      t("surveys.issue.conditionUnknownOption", { q: "条件题" }),
    );
  });

  it("orphan_question 与 question_in_multiple_pages 指出题干", () => {
    const orphan = base();
    orphan.questions.push({ id: "q2", type: "text", title: "孤儿题", required: false });
    expect(textOf(orphan, "orphan_question")).toBe(
      t("surveys.issue.orphanQuestion", { q: "孤儿题" }),
    );
    const multi = base();
    multi.pages.push({ id: "p2", title: "第二页", questionIds: ["q1"] });
    expect(textOf(multi, "question_in_multiple_pages")).toBe(
      t("surveys.issue.questionInMultiplePages", { q: "第一题" }),
    );
  });

  it("unknown_question / unknown_page / jump_not_forward 带页序或通用句", () => {
    const missing = base();
    missing.pages[0]!.questionIds.push("q_missing");
    expect(textOf(missing, "unknown_question")).toBe(
      t("surveys.issue.unknownQuestionInPage", { n: 1 }),
    );
    const unknownPage = base();
    unknownPage.pages[0]!.jump = {
      when: { questionId: "q1", op: "eq", value: "x" },
      targetPageId: "p0",
    };
    expect(textOf(unknownPage, "unknown_page")).toBe(
      t("surveys.issue.unknownPage", { n: 1 }),
    );
    const backward = base();
    backward.pages.push({ id: "p2", title: "第二页", questionIds: [] });
    backward.pages[1]!.jump = {
      when: { questionId: "q1", op: "eq", value: "x" },
      targetPageId: "p1",
    };
    expect(textOf(backward, "jump_not_forward")).toBe(
      t("surveys.issue.jumpNotForward", { n: 2 }),
    );
  });

  it("schema 结构错误落到定位兜底，未知 code 不带内部路径", () => {
    const def = base();
    def.title = "";
    const [schemaIssue] = validateSurveyDefinition(def);
    expect(schemaIssue!.code).toMatch(/^schema\./);
    expect(describeSurveyIssue(def, schemaIssue!, t)).toBe(
      t("surveys.issue.schemaGeneric"),
    );
    const bare = describeSurveyIssue(
      def,
      { path: "", code: "some_future_code", message: "x" },
      t,
    );
    expect(bare).toBe(t("surveys.issue.schemaGeneric"));
    expect(bare).not.toMatch(/questions\.|pages\./);
  });

  it("覆盖 validateSurveyDefinition 的全部语义 code，无一落进兜底", () => {
    const def = base();
    def.questions.push(
      { id: "q2", type: "single", title: "选择", required: false, options: [] },
      { id: "q3", type: "scale", title: "量表", required: false, min: 5, max: 1 },
      { id: "q4", type: "number", title: "数字", required: false, min: 5, max: 1 },
      { id: "q5", type: "text", title: "孤儿", required: false },
    );
    def.pages.push({ id: "p2", title: "空页", questionIds: [] });
    def.pages[0]!.questionIds.push("q_missing");
    const issues = validateSurveyDefinition(def);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      const text = describeSurveyIssue(def, issue, t);
      expect(text, `${issue.code} fell through to schema generic`).not.toBe(
        t("surveys.issue.schemaGeneric"),
      );
      expect(text).not.toMatch(/questions\.\d|pages\.\d/);
    }
  });

  it("新 code：排序下限/说明块必答/日期范围/条件源不支持", () => {
    const rankingDef = base();
    rankingDef.questions.push({
      id: "q2",
      type: "ranking",
      title: "排序",
      required: false,
      options: [{ id: "o1", label: "唯一选项" }],
    });
    expect(textOf(rankingDef, "empty_options")).toBe(
      t("surveys.issue.rankingOptions", { q: "排序" }),
    );

    const stmtDef = base();
    stmtDef.questions.push({
      id: "q2",
      type: "statement",
      title: "",
      required: true,
      body: "说明",
    });
    expect(textOf(stmtDef, "statement_not_required")).toBe(
      t("surveys.issue.statementNotRequired", { q: "" }),
    );

    const dateDef = base();
    dateDef.questions.push({
      id: "q2",
      type: "date",
      title: "日期",
      required: false,
      min: "2026-12-31",
      max: "2026-01-01",
    });
    expect(textOf(dateDef, "invalid_date_range")).toBe(
      t("surveys.issue.dateRange", { q: "日期" }),
    );

    const condDef = base();
    condDef.questions.push(
      {
        id: "q2",
        type: "matrix_single",
        title: "矩阵",
        required: false,
        rows: [{ id: "r1", label: "行 1" }],
        columns: [
          { id: "c1", label: "不同意" },
          { id: "c2", label: "同意" },
        ],
      },
      {
        id: "q3",
        type: "text",
        title: "后题",
        required: false,
        showIf: { questionId: "q2", op: "eq", value: "c1" },
      },
    );
    condDef.pages[0]!.questionIds.push("q2", "q3");
    expect(textOf(condDef, "condition_unsupported_source")).toBe(
      t("surveys.issue.conditionUnsupportedSource", { q: "后题" }),
    );
  });
});
