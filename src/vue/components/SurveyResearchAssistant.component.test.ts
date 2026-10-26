import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import SurveyResearchAssistant from "./SurveyResearchAssistant.vue";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import { makeDefinition } from "../../core/test-fixtures.js";

function design() {
  return {
    researchQuestion: "使用情况", population: "实验室成员", recruitment: "", purpose: "describe" as const,
    timeBudgetMinutes: 5, constructs: [], analysisPlan: "描述统计", assumptions: [], pendingDecisions: [],
  };
}

describe("研究依据面板（M2：只管研究依据，不再有诊断）", () => {
  it("没有研究设计也能手动填写和记录试填，不依赖 AI", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { busy: false, disabled: false, hasCopilot: false },
    });
    expect(wrapper.find(".design-fields").exists()).toBe(false);
    await wrapper.findAll("button").find(button => button.text() === "修改信息")!.trigger("click");
    const question = wrapper.find(".design-fields textarea");
    await question.setValue("如何改善工具使用体验？");
    await question.trigger("change");
    expect(wrapper.emitted("update:design")?.at(-1)?.[0]).toMatchObject({
      researchQuestion: "如何改善工具使用体验？", constructs: [], assumptions: [],
    });
    wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 3);
    wrapper.findAllComponents(Textarea).at(-1)!.vm.$emit("update:modelValue", "题意需要澄清");
    await wrapper.vm.$nextTick();
    await wrapper.findAll("button").find(button => button.text() === "保存试填记录")!.trigger("click");
    expect(wrapper.emitted("update:design")?.at(-1)?.[0]).toMatchObject({
      pretest: { participantCount: 3, notes: "题意需要澄清" },
    });
    wrapper.unmount();
  });

  it("默认呈现已有研究摘要，AI 整理由用户发起且不伪造研究信息", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design: design(), busy: false, disabled: false, hasCopilot: true },
    });
    expect(wrapper.find(".design-fields").exists()).toBe(false);
    expect(wrapper.find(".design-summary").text()).toContain("实验室成员");
    expect(wrapper.find(".design-summary").text()).toContain("尚未明确");
    expect(wrapper.emitted("design-request")).toBeUndefined();
    await wrapper.findAll("button").find(button => button.text() === "让 AI 整理研究设计")!.trigger("click");
    expect(wrapper.emitted("design-request")).toEqual([[]]);
    expect(wrapper.emitted("update:design")).toBeUndefined();
    wrapper.unmount();
  });

  it("待确认事项默认可见；构念与假设收进 details 渐进披露", () => {
    const detailed = {
      ...design(),
      pendingDecisions: ["招募渠道尚未确定"],
      assumptions: ["答题者能接触目标工具"],
      constructs: [{ id: "c1", label: "使用频率", definition: "每周使用次数", questionIds: ["q1"] }],
    };
    const definition = makeDefinition();
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design: detailed, definition, questions: definition.questions, busy: false, disabled: false, hasCopilot: false },
    });
    expect(wrapper.text()).toContain("招募渠道尚未确定");
    const depth = wrapper.find(".design-details");
    expect(depth.exists()).toBe(true);
    // details 未展开时内容仍在 DOM 但默认折叠：断言结构与披露语义，不冒充摘要。
    expect(depth.element.hasAttribute("open")).toBe(false);
    expect(depth.text()).toContain("使用频率");
    expect(depth.text()).toContain("答题者能接触目标工具");
    wrapper.unmount();
  });

  it("试填反馈保存为作者记录，不伪称已完成独立验证", async () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design: design(), busy: false, disabled: false, hasCopilot: true },
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

  it("面板不再提供任何诊断入口：无应用/帮我完善按钮，也无过期与冲突提示", () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design: design(), busy: false, disabled: false, hasCopilot: true },
    });
    expect(wrapper.findAll("button").some((button) => button.text().startsWith("应用 "))).toBe(false);
    expect(wrapper.findAll("button").some((button) => button.text() === "帮我完善")).toBe(false);
    expect(wrapper.text()).not.toContain("问卷已修改");
    expect(wrapper.text()).not.toContain("这些修改存在冲突");
    wrapper.unmount();
  });

  it("只读状态禁止编辑，AI 整理入口禁用", () => {
    const wrapper = mountSurveysComponent(SurveyResearchAssistant, {
      props: { design: design(), busy: false, disabled: true, hasCopilot: true },
    });
    const addDesign = wrapper.findAll("button").find((button) => button.text() === "让 AI 整理研究设计")!;
    expect(addDesign.attributes("disabled")).toBeDefined();
    const edit = wrapper.findAll("button").find((button) => button.text() === "修改信息")!;
    expect(edit.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
