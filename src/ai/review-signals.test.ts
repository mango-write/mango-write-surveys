import { describe, expect, it } from "vitest";
import type { SurveyDefinition } from "../core/index.js";
import { surveyReviewSignals } from "./review-signals.js";

const definition: SurveyDefinition = {
  version: 1, title: "调查", description: "", consent: "",
  questions: [{ id: "q1", type: "single", title: "你使用工具的频率？", required: false,
    options: [{ id: "a", label: "每周一次" }, { id: "b", label: "经常" }] }],
  pages: [{ id: "p1", title: "使用", questionIds: ["q1"] }],
};

describe("诊断提示", () => {
  it("频率题缺少回忆期且选项混用时提示分别核对", () => {
    expect(surveyReviewSignals(definition).map((signal) => signal.kind)).toEqual(["recall_period", "frequency_anchors"]);
  });
  it("页说明已有共同回忆期时不误报缺失", () => {
    expect(surveyReviewSignals({ ...definition, pages: [{ ...definition.pages[0]!, description: "以下问题均指过去三个月" }] }).map((signal) => signal.kind)).toEqual(["frequency_anchors"]);
  });
  it("仅有主观词或仅有定量选项时不报混用", () => {
    const question = definition.questions[0]!;
    if (question.type !== "single") throw new Error("fixture");
    for (const label of ["很少", "每月一次"]) {
      const next = { ...definition, questions: [{ ...question, options: [{ id: "a", label }] }] };
      expect(surveyReviewSignals(next).some((signal) => signal.kind === "frequency_anchors")).toBe(false);
    }
  });
});
