import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import SurveyResearchAssistant from "./SurveyResearchAssistant.vue";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import { buildSurveyReviewPlan } from "../../core/index.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";

const report: Extract<ToolSurveyDelivery, { type: "survey_review" }> = {
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

function reviewProps(currentReport = report) {
  const definition = makeDefinition();
  return {
    definition,
    report: currentReport,
    plan: buildSurveyReviewPlan(definition, currentReport.findings),
    stale: false,
    busy: false,
    disabled: false,
    hasCopilot: true,
  };
}

describe("研究设计与诊断面板", () => {
  it("试填反馈保存为作者记录，不伪称已完成独立验证", async () => {
    const design = {
      researchQuestion: "使用情况", population: "实验室成员", recruitment: "自愿招募", purpose: "describe" as const,
      timeBudgetMinutes: 5, constructs: [], analysisPlan: "描述统计", assumptions: [], pendingDecisions: [],
    };
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design, report: null, plan: null, stale: false, busy: false, disabled: false, hasCopilot: true },
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

  it("过期方案禁止整批应用，仍可定位和查看依据", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { ...reviewProps(), stale: true },
    });
    const apply = wrapper.findAll("button").find((button) => button.text() === "应用 1 组修改")!;
    expect(apply.attributes("disabled")).toBeDefined();
    await apply.trigger("click");
    expect(wrapper.emitted("apply")).toBeUndefined();
    await wrapper.findAll("button").find((button) => button.text() === "第 1 题")!.trigger("click");
    expect(wrapper.emitted("locate")).toEqual([["q1"]]);
    expect(wrapper.findAll("a").some((link) => link.attributes("href")?.startsWith("https://"))).toBe(true);
    wrapper.unmount();
  });

  it("预览展示真实修改前后，一次发出整批应用且不自行修改草稿", async () => {
    const props = reviewProps();
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, { props });
    expect(wrapper.find(".change-row").text()).toContain("单选");
    expect(wrapper.find(".change-row").text()).toContain("过去一学期是否用 ChatGPT 写过综述？");
    expect(wrapper.text()).not.toContain("wording.presumptive");
    await wrapper.findAll("button").find((button) => button.text() === "应用 1 组修改")!.trigger("click");
    expect(wrapper.emitted("apply")).toEqual([[]]);
    expect(props.definition.questions[0]?.title).toBe("单选");
    wrapper.unmount();
  });

  it("语义相同的显示条件不因字段顺序变化而冒充修改", () => {
    const definition = makeDefinition();
    definition.questions[2] = {
      ...definition.questions[2]!,
      showIf: { value: "a", op: "eq" as const, questionId: "q1" },
    };
    const reorderedReport: typeof report = {
      ...report,
      findings: [{
        ...report.findings[0], questionId: "q3",
        suggestedOps: [{ op: "update_question", questionId: "q3", patch: { title: "澄清后的文本题" } }],
      }],
    };
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: {
        ...reviewProps(reorderedReport), definition,
        plan: buildSurveyReviewPlan(definition, reorderedReport.findings),
      },
    });
    expect(wrapper.findAll(".change-row")).toHaveLength(1);
    expect(wrapper.find(".change-row").text()).toContain("澄清后的文本题");
    expect(wrapper.text()).not.toContain("仅在前题满足条件时显示修改前");
    wrapper.unmount();
  });

  it("研究设计修订也展示真实的修改前后", () => {
    const designReport: typeof report = {
      ...report,
      findings: [{
        ...report.findings[0], questionId: undefined,
        suggestedOps: [{ op: "set_meta", researchDesign: {
          researchQuestion: "使用情况", population: "研究生", recruitment: "自愿招募", purpose: "describe",
          timeBudgetMinutes: 5, constructs: [], analysisPlan: "逐题报告有效数与缺失数", assumptions: [], pendingDecisions: [],
        } }],
      }],
    };
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, { props: reviewProps(designReport) });
    const analysisRow = wrapper.findAll(".change-row").find((row) => row.text().includes("预期分析"))!;
    expect(analysisRow.text()).toContain("未设置");
    expect(analysisRow.text()).toContain("逐题报告有效数与缺失数");
    wrapper.unmount();
  });

  it("只有人工判断项时不显示自动应用，也不冒充没有问题", () => {
    const manualReport = { ...report, findings: [{ ...report.findings[0], suggestedOps: undefined }] };
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, { props: reviewProps(manualReport) });
    expect(wrapper.text()).toContain("目前没有可安全自动修改的内容");
    expect(wrapper.text()).toContain("还需要你决定或验证");
    expect(wrapper.findAll("button").some((button) => button.text().startsWith("应用 "))).toBe(false);
    wrapper.unmount();
  });

  it("只读状态禁止诊断，空报告不宣称已验证", () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { ...reviewProps({ ...report, findings: [] }), disabled: true },
    });
    const review = wrapper.findAll("button").find((button) => button.text() === "帮我完善")!;
    expect(review.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("不代表已完成真人验证");
    wrapper.unmount();
  });
});
