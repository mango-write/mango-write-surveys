import { describe, expect, it } from "vitest";

import { validateSurveyDefinition } from "./index.js";
import { makeChainDefinition, makeDefinition } from "./test-fixtures.js";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("validateSurveyDefinition", () => {
  it("接受合法基准定义", () => {
    expect(validateSurveyDefinition(makeDefinition())).toEqual([]);
    expect(validateSurveyDefinition(makeChainDefinition())).toEqual([]);
  });

  it("拒绝 schema 形状错误（版本、类型、上限）", () => {
    expect(codes(validateSurveyDefinition({}))).toContain(
      "schema.invalid_type",
    );
    expect(
      codes(validateSurveyDefinition({ ...makeDefinition(), version: 2 })),
    ).toContain("schema.invalid_value");

    const tooManyQuestions = makeDefinition();
    tooManyQuestions.questions = Array.from({ length: 51 }, (_, i) => ({
      id: `qq${i}`,
      type: "text" as const,
      title: "t",
      required: false,
    }));
    expect(codes(validateSurveyDefinition(tooManyQuestions))).toContain(
      "schema.too_big",
    );

    const tooManyPages = makeDefinition();
    tooManyPages.pages = Array.from({ length: 21 }, (_, i) => ({
      id: `pp${i}`,
      title: "t",
      questionIds: ["q1"],
    }));
    expect(codes(validateSurveyDefinition(tooManyPages))).toContain(
      "schema.too_big",
    );

    const tooManyOptions = makeDefinition();
    const q1 = tooManyOptions.questions[0];
    if (q1.type !== "single") throw new Error("fixture");
    q1.options = Array.from({ length: 31 }, (_, i) => ({
      id: `o${i}`,
      label: "o",
    }));
    expect(codes(validateSurveyDefinition(tooManyOptions))).toContain(
      "schema.too_big",
    );
  });

  it("拒绝重复 id（题/页/选项）", () => {
    const dupQ = makeDefinition();
    dupQ.questions[1] = { ...dupQ.questions[1], id: "q1" };
    expect(codes(validateSurveyDefinition(dupQ))).toContain("duplicate_id");

    const dupP = makeDefinition();
    dupP.pages[2] = { ...dupP.pages[2], id: "p1" };
    expect(codes(validateSurveyDefinition(dupP))).toContain("duplicate_id");

    const dupO = makeDefinition();
    const q1 = dupO.questions[0];
    if (q1.type !== "single") throw new Error("fixture");
    q1.options[1] = { id: "a", label: "B" };
    expect(codes(validateSurveyDefinition(dupO))).toContain("duplicate_id");
  });

  it("拒绝空页、无归属题、跨页重复归属、页引用未知题", () => {
    const empty = makeDefinition();
    empty.pages[2] = { id: "p3", title: "三", questionIds: [] };
    empty.pages[1].questionIds.push("q5");
    expect(codes(validateSurveyDefinition(empty))).toContain("empty_page");

    const orphan = makeDefinition();
    orphan.pages[1].questionIds = ["q3"];
    expect(codes(validateSurveyDefinition(orphan))).toContain(
      "orphan_question",
    );

    const multi = makeDefinition();
    multi.pages[0].questionIds.push("q4");
    expect(codes(validateSurveyDefinition(multi))).toContain(
      "question_in_multiple_pages",
    );

    const unknown = makeDefinition();
    unknown.pages[0].questionIds = ["q1", "q9"];
    expect(codes(validateSurveyDefinition(unknown))).toContain(
      "unknown_question",
    );
  });

  it("拒绝引用后题/自身/不存在题的条件与循环", () => {
    const later = makeDefinition();
    later.questions[0].showIf = { questionId: "q4", op: "eq", value: 1 };
    expect(codes(validateSurveyDefinition(later))).toContain(
      "condition_not_previous",
    );

    const self = makeDefinition();
    self.questions[0].showIf = { questionId: "q1", op: "eq", value: "a" };
    expect(codes(validateSurveyDefinition(self))).toContain(
      "condition_not_previous",
    );

    const missing = makeDefinition();
    missing.questions[0].showIf = { questionId: "nope", op: "eq", value: "a" };
    expect(codes(validateSurveyDefinition(missing))).toContain(
      "unknown_question",
    );

    // 循环：q3↔q4 互相 showIf，序在后的引用成立、序在前的必然违规。
    const cycle = makeDefinition();
    cycle.questions[2].showIf = { questionId: "q4", op: "eq", value: 1 };
    cycle.questions[3].showIf = { questionId: "q3", op: "eq", value: "x" };
    expect(codes(validateSurveyDefinition(cycle))).toContain(
      "condition_not_previous",
    );
  });

  it("拒绝类型不匹配的条件与未知选项条件值", () => {
    const wrongOp = makeDefinition();
    wrongOp.questions[3].showIf = {
      questionId: "q1",
      op: "contains",
      value: "a",
    };
    expect(codes(validateSurveyDefinition(wrongOp))).toContain(
      "condition_type_mismatch",
    );

    const wrongValueType = makeDefinition();
    wrongValueType.questions[3].showIf = {
      questionId: "q1",
      op: "eq",
      value: 1,
    };
    expect(codes(validateSurveyDefinition(wrongValueType))).toContain(
      "condition_type_mismatch",
    );

    const unknownOption = makeDefinition();
    unknownOption.questions[3].showIf = {
      questionId: "q1",
      op: "eq",
      value: "c",
    };
    expect(codes(validateSurveyDefinition(unknownOption))).toContain(
      "condition_unknown_option",
    );

    const scaleOut = makeDefinition();
    scaleOut.questions[4].showIf = { questionId: "q1", op: "eq", value: "a" };
    scaleOut.questions[3].showIf = { questionId: "q1", op: "eq", value: "a" };
    expect(codes(validateSurveyDefinition(scaleOut))).not.toContain(
      "condition_type_mismatch",
    );

    // 引用量表题的条件值必须是量程内整数。
    // 引用量表题的条件值必须是量程内整数：把 q5 挪到 p1，jump 条件引用同页 q5。
    const scaleCond = makeDefinition();
    scaleCond.pages[0].questionIds = ["q1", "q2", "q5"];
    scaleCond.pages[2].questionIds = [];
    scaleCond.pages[0].jump = {
      when: { questionId: "q5", op: "eq", value: 99 },
      targetPageId: "p3",
    };
    expect(codes(validateSurveyDefinition(scaleCond))).toContain(
      "condition_type_mismatch",
    );
  });

  it("拒绝向前跳页、未知跳页目标、跳页条件引用后页题", () => {
    const back = makeDefinition();
    back.pages[1].jump = {
      when: { questionId: "q3", op: "eq", value: "x" },
      targetPageId: "p1",
    };
    expect(codes(validateSurveyDefinition(back))).toContain("jump_not_forward");

    const missing = makeDefinition();
    missing.pages[0].jump = {
      when: { questionId: "q2", op: "contains", value: "y" },
      targetPageId: "p9",
    };
    expect(codes(validateSurveyDefinition(missing))).toContain("unknown_page");

    const laterQ = makeDefinition();
    laterQ.pages[0].jump = {
      when: { questionId: "q4", op: "eq", value: 1 },
      targetPageId: "p3",
    };
    expect(codes(validateSurveyDefinition(laterQ))).toContain(
      "condition_not_previous",
    );
  });

  it("拒绝非法取值范围（量表跨度/数字区间/选择数/空选项）", () => {
    const scale = makeDefinition();
    scale.questions[4] = {
      id: "q5",
      type: "scale",
      title: "量表",
      required: false,
      min: 1,
      max: 12,
    };
    expect(codes(validateSurveyDefinition(scale))).toContain(
      "invalid_scale_range",
    );

    const num = makeDefinition();
    num.questions[3] = {
      id: "q4",
      type: "number",
      title: "数字",
      required: true,
      min: 10,
      max: 1,
    };
    expect(codes(validateSurveyDefinition(num))).toContain(
      "invalid_number_range",
    );

    const multi = makeDefinition();
    const qm = multi.questions[1];
    if (qm.type !== "multiple") throw new Error("fixture");
    qm.minChoices = 3;
    qm.maxChoices = 2;
    expect(codes(validateSurveyDefinition(multi))).toContain(
      "invalid_choice_range",
    );

    const noOpt = makeDefinition();
    noOpt.questions[0] = {
      id: "q1",
      type: "single",
      title: "单选",
      required: true,
      options: [],
    };
    expect(codes(validateSurveyDefinition(noOpt))).toContain("empty_options");
  });

  it("页说明为可选字段：缺省与合法值通过，超长被 schema 拦（additive，老定义不受影响）", () => {
    const withDescription = makeDefinition();
    withDescription.pages[0] = {
      ...withDescription.pages[0],
      description: "本页收集人口学信息",
    };
    expect(validateSurveyDefinition(withDescription)).toEqual([]);

    const tooLong = makeDefinition();
    tooLong.pages[0] = {
      ...tooLong.pages[0],
      description: "长".repeat(2001),
    };
    expect(codes(validateSurveyDefinition(tooLong))).toContain(
      "schema.too_big",
    );
  });
});
