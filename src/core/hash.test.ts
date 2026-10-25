import { describe, expect, it } from "vitest";

import { canonicalSurveyJson } from "./hash.js";

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
