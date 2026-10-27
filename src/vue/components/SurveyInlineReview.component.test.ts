import { defineComponent, h, ref } from "vue";
import { describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSurveysComponent } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import SurveyInlineReview from "./SurveyInlineReview.vue";

const PopoverStub = defineComponent({
  name: "Popover",
  emits: ["show", "hide"],
  setup(_, { expose, emit, slots }) {
    const visible = ref(false);
    expose({
      toggle: () => {
        visible.value = !visible.value;
        emit(visible.value ? "show" : "hide");
      },
      hide: () => {
        visible.value = false;
        emit("hide");
      },
    });
    return () => visible.value ? h("div", { class: "popover-stub" }, slots.default?.()) : null;
  },
});
const report: Extract<ToolSurveyDelivery, { type: "survey_review" }> = {
  type: "survey_review", surveyId: "s1", operationId: "review-1", baseDraftVersion: 1, summary: "澄清范围",
  findings: [{ id: "f1", checkId: "wording.timeframe", questionId: "q1", title: "时间范围", severity: "major", reason: "缺少时间范围", recommendation: "说明过去一学期", suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一学期的使用情况" } }] }],
};
function mount(overrides: Partial<typeof report> = {}, props: { stale?: boolean; questionId?: string } = {}) {
  const current = { ...report, ...overrides };
  return mountSurveysComponent(SurveyInlineReview, {
    props: { questionId: props.questionId ?? "q1", definition: makeDefinition(), report: current, stale: props.stale ?? false },
    global: { stubs: { Popover: PopoverStub } },
  });
}
describe("题目旁的诊断气泡", () => {
  it("默认只有固定锚点，打开后只显示修改前后与依据", async () => {
    const wrapper = mount();
    expect(wrapper.find(".review-popover").exists()).toBe(false);
    expect(wrapper.find(".inline-review__trigger").attributes("aria-expanded")).toBe("false");
    await wrapper.find(".inline-review__trigger").trigger("click");
    await flushPromises();
    expect(wrapper.find(".review-popover").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("缺少时间范围");
    expect(wrapper.text()).toContain("过去一学期的使用情况");
    expect(wrapper.text()).toContain("修改前");
    expect(wrapper.find(".inline-review__trigger").attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll("a").some((link) => link.attributes("href")?.startsWith("https://"))).toBe(true);
    wrapper.unmount();
  });
  it("每条建议独立发出应用与忽略事件", async () => {
    const wrapper = mount();
    await wrapper.find(".inline-review__trigger").trigger("click");
    await wrapper.findAll("button").find((button) => button.text() === "应用此建议")!.trigger("click");
    expect(wrapper.emitted("apply")).toEqual([["f1"]]);
    await wrapper.findAll("button").find((button) => button.text() === "忽略")!.trigger("click");
    expect(wrapper.emitted("dismiss")).toEqual([["f1"]]);
    wrapper.unmount();
  });
  it("人工判断建议没有应用按钮", async () => {
    const wrapper = mount({ findings: [{ ...report.findings[0]!, suggestedOps: undefined }] });
    await wrapper.find(".inline-review__trigger").trigger("click");
    expect(wrapper.text()).toContain("说明过去一学期");
    expect(wrapper.text()).not.toContain("没有可安全自动修改的内容");
    expect(wrapper.findAll("button").some((button) => button.text() === "应用此建议")).toBe(false);
    wrapper.unmount();
  });
  it("方案过期时隐藏差异并禁用应用", async () => {
    const wrapper = mount({}, { stale: true });
    await wrapper.find(".inline-review__trigger").trigger("click");
    expect(wrapper.text()).toContain("问卷已修改");
    expect(wrapper.text()).not.toContain("过去一学期的使用情况");
    expect(wrapper.findAll("button").find((button) => button.text() === "应用此建议")!.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it("新增题归插入锚点，不在封面重复出现", async () => {
    const addition = {
      ...report.findings[0]!, questionId: undefined,
      suggestedOps: [{ op: "add_question" as const, pageId: "p1", question: { id: "q-new", type: "text", title: "新题", required: false } }],
    };
    const cover = mount({ findings: [addition] }, { questionId: undefined });
    expect(cover.find(".inline-review__trigger").exists()).toBe(false);
    cover.unmount();
    const inserted = mount({ findings: [addition] }, { questionId: "q-new" });
    expect(inserted.find(".inline-review__trigger").exists()).toBe(true);
    inserted.unmount();
  });
  it("带证据与影响时展示逐字摘录块与影响行；缺省时不渲染占位", async () => {
    const withEvidence = mount({
      findings: [{
        ...report.findings[0]!,
        evidence: "你使用科研工具的频率如何？",
        impact: "双重提问会让答案无法归因。",
      }],
    });
    await withEvidence.find(".inline-review__trigger").trigger("click");
    await flushPromises();
    expect(withEvidence.find(".review-finding__evidence").text()).toContain("你使用科研工具的频率如何？");
    expect(withEvidence.find(".review-finding__impact").text()).toContain("双重提问会让答案无法归因。");
    withEvidence.unmount();

    const plain = mount();
    await plain.find(".inline-review__trigger").trigger("click");
    await flushPromises();
    expect(plain.find(".review-finding__evidence").exists()).toBe(false);
    expect(plain.find(".review-finding__impact").exists()).toBe(false);
    plain.unmount();
  });
});
