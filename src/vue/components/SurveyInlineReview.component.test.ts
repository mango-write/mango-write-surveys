import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import { buildSurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import SurveyInlineReview from "./SurveyInlineReview.vue";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";
const report: Extract<ToolSurveyDelivery, { type: "survey_review" }> = {
  type: "survey_review", surveyId: "s1", operationId: "review-1", baseDraftVersion: 1, summary: "澄清范围",
  findings: [{ id: "f1", questionId: "q1", title: "时间范围", severity: "major", reason: "缺少时间范围", recommendation: "说明过去一学期", suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一学期的使用情况" } }] }],
};
describe("题目旁的研究建议", () => {
  it("以真实题目组件预览候选，采纳前不修改原题", async () => {
    const definition = makeDefinition();
    const wrapper = mountSurveysComponent(SurveyInlineReview, { props: { questionId: "q1", definition, report, plan: buildSurveyReviewPlan(definition, report.findings), disabled: false } });
    expect(wrapper.findComponent(SurveyQuestionCard).props("question").title).toBe("过去一学期的使用情况");
    expect(wrapper.text()).toContain("缺少时间范围");
    await wrapper.findAll("button").find(b => b.text() === "采纳本轮修改")!.trigger("click");
    expect(wrapper.emitted("apply")).toEqual([[]]);
    expect(definition.questions[0]!.title).toBe("单选");
    wrapper.unmount();
  });
  it("过期或只读时仍能阅读预览，但不能采纳", async () => {
    const definition = makeDefinition();
    const wrapper = mountSurveysComponent(SurveyInlineReview, { props: { questionId: "q1", definition, report, plan: buildSurveyReviewPlan(definition, report.findings), disabled: true } });
    const accept = wrapper.findAll("button").find(b => b.text() === "采纳本轮修改")!;
    expect(accept.attributes("disabled")).toBeDefined();
    await accept.trigger("click");
    expect(wrapper.emitted("apply")).toBeUndefined();
    wrapper.unmount();
  });
});
