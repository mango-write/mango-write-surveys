import { describe, expect, it } from "vitest";

import {
  SurveyAnswersSchema,
  SurveyDefinitionSchema,
  validateSurveyAnswers,
  type SurveyDefinition,
} from "./index.js";
import { makeChainDefinition, makeDefinition } from "./test-fixtures.js";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("validateSurveyAnswers", () => {
  it("rejects prototype property identifiers before they can bypass missing checks", () => {
    expect(
      SurveyAnswersSchema.safeParse(
        JSON.parse('{"q1":"b","q4":0,"__proto__":"x"}'),
      ).success,
    ).toBe(false);
    const def = makeDefinition();
    def.questions[0].id = "constructor";
    def.pages[0].questionIds[0] = "constructor";
    expect(SurveyDefinitionSchema.safeParse(def).success).toBe(false);
    def.questions[0].id = "field.with.dot";
    def.pages[0].questionIds[0] = "field.with.dot";
    expect(SurveyDefinitionSchema.safeParse(def).success).toBe(false);
    expect(
      validateSurveyAnswers(
        makeDefinition(),
        JSON.parse('{"q1":"b","q4":0,"__proto__":"x"}'),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("接受沿当前路径的完整合法答案", () => {
    const def = makeDefinition();
    expect(
      validateSurveyAnswers(def, {
        q1: "a",
        q2: ["x"],
        q3: "你好",
        q4: 42,
        q5: 3,
      }),
    ).toEqual([]);
    // q1=b 时 q3 隐藏不追答，q4 必答（0 是合法值）
    expect(validateSurveyAnswers(def, { q1: "b", q4: 0 })).toEqual([]);
  });

  it("拒绝非 object / null 值 / 超长串等 schema 级错误", () => {
    const def = makeDefinition();
    expect(codes(validateSurveyAnswers(def, null))).toContain(
      "schema.invalid_type",
    );
    expect(codes(validateSurveyAnswers(def, { q1: null }))).toContain(
      "schema.invalid_union",
    );
    expect(
      codes(validateSurveyAnswers(def, { q3: "x".repeat(2001) })),
    ).toContain("schema.too_big");
  });

  it("拒绝未知 qid 与隐藏题答案（路径操纵）", () => {
    const def = makeDefinition();
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", ghost: "x" })),
    ).toContain("unknown_question");
    // q1=b ⇒ q3 隐藏，塞 q3 答案必须拒
    expect(
      codes(validateSurveyAnswers(def, { q1: "b", q3: "x", q4: 1 })),
    ).toContain("hidden_answer");
    // 跳页后 p2 的答案必须拒
    const r = validateSurveyAnswers(def, {
      q1: "a",
      q2: ["y"],
      q3: "x",
      q4: 1,
      q5: 2,
    });
    expect(codes(r)).toContain("hidden_answer");
    // 隐藏链：c2 隐藏时其答案 + c3 答案都拒
    const chain = makeChainDefinition();
    const r2 = validateSurveyAnswers(chain, { c1: "b", c2: "open", c3: "x" });
    expect(codes(r2).filter((c) => c === "hidden_answer")).toHaveLength(2);
  });

  it("拒绝非法选项 / 类型错误 / 重复选项 / 互斥冲突 / 选择数越界", () => {
    const def = makeDefinition();
    expect(codes(validateSurveyAnswers(def, { q1: "c" }))).toContain(
      "invalid_option",
    );
    expect(codes(validateSurveyAnswers(def, { q1: 1 }))).toContain(
      "invalid_type",
    );
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: ["x", "nope"] })),
    ).toContain("invalid_option");
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: ["x", "x"] })),
    ).toContain("duplicate_option");
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: ["x", "z"] })),
    ).toContain("exclusive_conflict");
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: ["x", "y", "z"] })),
    ).toEqual(
      expect.arrayContaining(["exclusive_conflict", "too_many_choices"]),
    );
    // 互斥选项单独选合法
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: ["z"] })),
    ).not.toContain("exclusive_conflict");
  });

  it("拒绝非法数值（范围/整数）与文本超限", () => {
    const def = makeDefinition();
    expect(codes(validateSurveyAnswers(def, { q1: "a", q4: 121 }))).toContain(
      "out_of_range",
    );
    expect(codes(validateSurveyAnswers(def, { q1: "a", q4: -1 }))).toContain(
      "out_of_range",
    );
    expect(codes(validateSurveyAnswers(def, { q1: "a", q4: "42" }))).toContain(
      "invalid_type",
    );
    expect(codes(validateSurveyAnswers(def, { q1: "a", q5: 6 }))).toContain(
      "out_of_range",
    );
    expect(codes(validateSurveyAnswers(def, { q1: "a", q5: 3.5 }))).toContain(
      "invalid_type",
    );

    const short = makeDefinition();
    const q3 = short.questions[2];
    if (q3.type !== "text") throw new Error("fixture");
    q3.maxLength = 5;
    expect(
      codes(validateSurveyAnswers(short, { q1: "a", q3: "123456" })),
    ).toContain("too_long");
    expect(
      codes(validateSurveyAnswers(short, { q1: "a", q3: "12345" })),
    ).not.toContain("too_long");
  });

  it("必答：可见必答缺失拒、隐藏必答不追、空值按未答计", () => {
    const def = makeDefinition();
    const r = validateSurveyAnswers(def, {});
    expect(codes(r).filter((c) => c === "required_missing")).toHaveLength(2); // q1 + q4，q3 隐藏不追
    // 空字符串/空数组是「应省略」的空答案；必答题按未答报 required_missing
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q3: "", q4: 1 })),
    ).toContain("required_missing");
    expect(
      codes(validateSurveyAnswers(def, { q1: "a", q2: [], q4: 1 })),
    ).toContain("empty_answer");
  });

  it("矩阵/多项填空必答缺失按行/项发 required_missing（path 带 rowId/itemId）", () => {
    const def: SurveyDefinition = {
      version: 1,
      title: "矩阵必答",
      description: "",
      consent: "",
      questions: [
        {
          id: "ms",
          type: "matrix_single",
          title: "矩阵",
          required: true,
          rows: [
            { id: "r1", label: "行一" },
            { id: "r2", label: "行二" },
          ],
          columns: [
            { id: "c1", label: "不同意" },
            { id: "c2", label: "同意" },
          ],
        },
        {
          id: "mt",
          type: "multi_text",
          title: "多项填空",
          required: true,
          items: [{ id: "i1", label: "项一" }],
        },
      ],
      pages: [{ id: "p1", title: "一", questionIds: ["ms", "mt"] }],
    };
    // 整题缺席与空对象同口径：逐行/项、path 带 rowId/itemId，题级 path 不再出现。
    for (const answers of [{}, { ms: {}, mt: {} }]) {
      const paths = validateSurveyAnswers(def, answers)
        .filter((i) => i.code === "required_missing")
        .map((i) => i.path);
      expect(paths).toEqual(["ms.r1", "ms.r2", "mt.i1"]);
    }
  });
});
