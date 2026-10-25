import { describe, expect, it } from "vitest";

import { evaluateSurveyPath, pruneSurveyAnswers } from "./index.js";
import { makeChainDefinition, makeDefinition } from "./test-fixtures.js";

describe("evaluateSurveyPath", () => {
  it("无跳转顺序走完全部页，showIf 按可见前题求值", () => {
    const def = makeDefinition();
    expect(evaluateSurveyPath(def, { q1: "a", q2: ["x"] })).toEqual({
      pageIds: ["p1", "p2", "p3"],
      questionIds: ["q1", "q2", "q3", "q4", "q5"],
    });
    // q1=b 时 q3 不可见
    expect(evaluateSurveyPath(def, { q1: "b" }).questionIds).toEqual([
      "q1",
      "q2",
      "q4",
      "q5",
    ]);
    // q1 未答时依赖 q1 的 q3 不可见
    expect(evaluateSurveyPath(def, {}).questionIds).toEqual([
      "q1",
      "q2",
      "q4",
      "q5",
    ]);
  });

  it("向后跳页跳过中间页", () => {
    const def = makeDefinition();
    const r = evaluateSurveyPath(def, { q1: "a", q2: ["y"] });
    expect(r.pageIds).toEqual(["p1", "p3"]);
    expect(r.questionIds).toEqual(["q1", "q2", "q5"]);
  });

  it("隐藏题的答案不能点亮后续分支", () => {
    const def = makeChainDefinition();
    // c1=b ⇒ c2 隐藏；此时塞 c2=open 也不能让 c3 可见。
    const r = evaluateSurveyPath(def, { c1: "b", c2: "open", c3: "x" });
    expect(r.questionIds).toEqual(["c1"]);
    // 合法链：c1=a → c2 可见且答 open → c3 可见。
    expect(
      evaluateSurveyPath(def, { c1: "a", c2: "open" }).questionIds,
    ).toEqual(["c1", "c2", "c3"]);
    // c1=a 但 c2 未答/答案不符 → c3 不可见。
    expect(evaluateSurveyPath(def, { c1: "a" }).questionIds).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("类型不符的答案不参与条件求值", () => {
    const def = makeDefinition();
    // q2 是 multiple，塞字符串 "y" 不能触发 contains 跳转。
    const r = evaluateSurveyPath(def, {
      q1: "a",
      q2: "y" as unknown as string[],
    });
    expect(r.pageIds).toEqual(["p1", "p2", "p3"]);
  });
});

describe("pruneSurveyAnswers", () => {
  it("只清掉不可见/未知题的答案，其余原样保留", () => {
    const def = makeDefinition();
    const out = pruneSurveyAnswers(def, {
      q1: "b",
      q3: "应被清掉",
      q4: 42,
      ghost: "x",
    });
    expect(out).toEqual({ q1: "b", q4: 42 });
  });

  it("跳页后被跳过页的答案被清掉", () => {
    const def = makeDefinition();
    const out = pruneSurveyAnswers(def, {
      q1: "a",
      q2: ["y"],
      q3: "被跳过",
      q4: 1,
      q5: 4,
    });
    expect(out).toEqual({ q1: "a", q2: ["y"], q5: 4 });
  });

  it("不修正可见题的非法值（服务端应拒绝而不是被 prune 掩盖）", () => {
    const def = makeDefinition();
    const out = pruneSurveyAnswers(def, { q1: "not-an-option", q4: 9999 });
    expect(out).toEqual({ q1: "not-an-option", q4: 9999 });
  });
});
