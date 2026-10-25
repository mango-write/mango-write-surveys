import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import SurveyResearchAssistant from "./SurveyResearchAssistant.vue";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";

const report = {
  type: "survey_review" as const,
  surveyId: "00000000-0000-4000-8000-000000000001",
  operationId: "review-123",
  baseDraftVersion: 2,
  summary: "筛选范围需要与追问一致",
  findings: [{
    id: "f1", checkId: "wording.presumptive", questionId: "q1", title: "筛选不充分",
    severity: "major" as const, reason: "用过任意 AI 不代表用它写过综述。",
    recommendation: "精确筛选经历。",
    suggestedOps: [{ op: "update_question" as const, questionId: "q1", patch: { title: "过去一学期是否用 ChatGPT 写过综述？" } }],
  }],
};

describe("研究设计与诊断面板", () => {
  it("试填反馈保存为作者记录，不伪称已完成独立验证", async () => {
    const design = {
      researchQuestion: "使用情况", population: "实验室成员", recruitment: "自愿招募", purpose: "describe" as const,
      timeBudgetMinutes: 5, constructs: [], analysisPlan: "描述统计", assumptions: [], pendingDecisions: [],
    };
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design, report: null, stale: false, busy: false, disabled: false, hasCopilot: true },
    });
    wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 2);
    wrapper.findAllComponents(Textarea).at(-1)!.vm.$emit("update:modelValue", "两位试填者不理解使用频率的时间范围，需改写。");
    await wrapper.vm.$nextTick();
    await wrapper.findAll("button").find((button) => button.text() === "保存试填记录")!.trigger("click");
    expect(wrapper.emitted("update:design")?.[0]?.[0]).toMatchObject({
      pretest: { participantCount: 2, notes: "两位试填者不理解使用频率的时间范围，需改写。", recordedAt: expect.any(String) },
    });
    wrapper.unmount();
  });
  it("过期建议禁止应用，仍可定位和查看依据", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { report, stale: true, busy: false, disabled: false, hasCopilot: true },
    });
    const apply = wrapper.findAll("button").find((button) => button.text() === "应用建议")!;
    expect(apply.attributes("disabled")).toBeDefined();
    await apply.trigger("click");
    expect(wrapper.emitted("apply")).toBeUndefined();
    await wrapper.findAll("button").find((button) => button.text() === "定位题目")!.trigger("click");
    expect(wrapper.emitted("locate")).toEqual([["q1"]]);
    expect(wrapper.findAll("a").some((link) => link.attributes("href")?.startsWith("https://"))).toBe(true);
    wrapper.unmount();
  });

  it("应用只发出指定建议，不自行修改草稿", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { report, stale: false, busy: false, disabled: false, hasCopilot: true },
    });
    await wrapper.findAll("button").find((button) => button.text() === "应用建议")!.trigger("click");
    expect(wrapper.emitted("apply")).toEqual([["f1"]]);
    expect(report.findings[0].questionId).toBe("q1");
    wrapper.unmount();
  });

  it("只读状态禁止诊断与应用，空报告不宣称已验证", () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { report: { ...report, findings: [] }, stale: false, busy: false, disabled: true, hasCopilot: true },
    });
    const review = wrapper.findAll("button").find((button) => button.text() === "诊断问卷")!;
    expect(review.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("不代表已完成真人验证");
    wrapper.unmount();
  });
});
