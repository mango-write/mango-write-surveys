// 逐题诊断投影测试（M2）：只显示原因/候选预览与依据链接；没有任何应用入口。
import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import { buildSurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import SurveyInlineReview from "./SurveyInlineReview.vue";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";
const report: Extract<ToolSurveyDelivery, { type: "survey_review" }> = {
  type: "survey_review", surveyId: "s1", operationId: "review-1", baseDraftVersion: 1, summary: "澄清范围",
  findings: [{ id: "f1", checkId: "wording.timeframe", questionId: "q1", title: "时间范围", severity: "major", reason: "缺少时间范围", recommendation: "说明过去一学期", suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一学期的使用情况" } }] }],
};
function mount(overrides: Partial<typeof report> = {}, props: { stale?: boolean } = {}) {
  const definition = makeDefinition();
  const current = { ...report, ...overrides };
  return mountSurveysComponent(SurveyInlineReview, {
    props: { questionId: "q1", definition, report: current, plan: buildSurveyReviewPlan(definition, current.findings), stale: props.stale ?? false },
  });
}
describe("题目旁的诊断投影", () => {
  it("以真实题目组件预览候选，不修改原题", () => {
    const wrapper = mount();
    expect(wrapper.findComponent(SurveyQuestionCard).props("question").title).toBe("过去一学期的使用情况");
    expect(wrapper.text()).toContain("缺少时间范围");
    wrapper.unmount();
  });
  it("投影没有应用入口：无采纳按钮，也不发出 apply 事件", async () => {
    const wrapper = mount();
    expect(wrapper.findAll("button").some((b) => b.text() === "采纳本轮修改" || b.text().startsWith("应用"))).toBe(false);
    expect(wrapper.emitted("apply")).toBeUndefined();
    // 依据收进 details：按 finding citations 展示标准出处，单源复用不复制。
    const sources = wrapper.find(".inline-review-sources");
    expect(sources.exists()).toBe(true);
    expect(sources.text()).toContain("方法依据");
    expect(wrapper.findAll("a").some((link) => link.attributes("href")?.startsWith("https://"))).toBe(true);
    wrapper.unmount();
  });
  it("manual-only 方案只给阅读提示，不冒充可应用", () => {
    const wrapper = mount({ findings: [{ ...report.findings[0]!, suggestedOps: undefined }] });
    expect(wrapper.text()).toContain("目前没有可安全自动修改的内容");
    expect(wrapper.findAll("button").some((b) => b.text() === "采纳本轮修改" || b.text().startsWith("应用"))).toBe(false);
    wrapper.unmount();
  });
  it("方案过期：隐藏候选预览并一致提示过期，只留原因阅读，不诱导按旧候选手改", () => {
    const wrapper = mount({}, { stale: true });
    expect(wrapper.text()).toContain("问卷已修改");
    expect(wrapper.text()).toContain("缺少时间范围");
    expect(wrapper.findComponent(SurveyQuestionCard).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("过去一学期的使用情况");
    wrapper.unmount();
  });
});
