import { describe, expect, it } from "vitest";

import { makeDefinition } from "./test-fixtures.js";
import { canonicalContentJson, canonicalSurveyJson } from "./hash.js";

describe("canonicalSurveyJson", () => {
  it("递归排序对象键、保留数组顺序", () => {
    expect(canonicalSurveyJson({ b: { d: 1, c: 2 }, a: 0 })).toBe(
      '{"a":0,"b":{"c":2,"d":1}}',
    );
    expect(canonicalSurveyJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("键序不同、嵌套相同的输入得到同一字符串", () => {
    const a = { questions: [{ id: "q1", title: "x" }], version: 1 };
    const b = { version: 1, questions: [{ title: "x", id: "q1" }] };
    expect(canonicalSurveyJson(a)).toBe(canonicalSurveyJson(b));
  });

  it("原型链键按自有键处理，非安全键名原样保留", () => {
    const withProto = JSON.parse('{"__proto__":"x","q1":"x"}');
    expect(canonicalSurveyJson(withProto)).toBe('{"__proto__":"x","q1":"x"}');
  });
});

describe("canonicalContentJson（内容指纹口径）", () => {
  it("剥掉 pretest：仅补试填记录不改变指纹", () => {
    const design = {
      researchQuestion: "RQ",
      population: "",
      recruitment: "",
      purpose: "describe" as const,
      timeBudgetMinutes: 5,
      constructs: [],
      analysisPlan: "",
      assumptions: [],
      pendingDecisions: [],
    };
    const withPretest = {
      ...makeDefinition(),
      researchDesign: { ...design, pretest: { participantCount: 3, notes: "x", recordedAt: "t" } },
    };
    const withoutPretest = { ...makeDefinition(), researchDesign: design };
    expect(canonicalContentJson(withPretest)).toBe(canonicalContentJson(withoutPretest));
    expect(canonicalContentJson(withPretest)).not.toBe(canonicalContentJson(makeDefinition()));
  });

  it("试填合成的全空研究设计基底视为无设计：与无 researchDesign 键的定义同指纹", () => {
    const emptyBase = {
      ...makeDefinition(),
      researchDesign: {
        researchQuestion: "",
        population: "",
        recruitment: "",
        purpose: "describe" as const,
        timeBudgetMinutes: 5,
        constructs: [],
        analysisPlan: "",
        assumptions: [],
        pendingDecisions: [],
        pretest: { participantCount: 2, notes: "", recordedAt: "t" },
      },
    };
    expect(canonicalContentJson(emptyBase)).toBe(canonicalContentJson(makeDefinition()));
  });

  it("真实研究设计参与指纹：改研究问题即改变指纹", () => {
    const changed = {
      ...makeDefinition(),
      researchDesign: {
        researchQuestion: "新的研究问题",
        population: "",
        recruitment: "",
        purpose: "describe" as const,
        timeBudgetMinutes: 5,
        constructs: [],
        analysisPlan: "",
        assumptions: [],
        pendingDecisions: [],
      },
    };
    expect(canonicalContentJson(changed)).not.toBe(canonicalContentJson(makeDefinition()));
  });
});
