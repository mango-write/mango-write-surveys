// 试填反馈面板（issue #224 阶段4）：复制通俗提纲（纯文本进剪贴板）、按题添加
// 四类反馈、既有记录回填与删除、人数缺失禁用保存。保存事件只 emit，落草稿
// 历史与自动保存的链路归工作台页（见 SurveyWorkspacePage.component.test.ts）。
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";

import { mountSurveysComponent, createTestHost } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { SurveyResearchPretest } from "../../core/index.js";
import SurveyPretestPanel from "./SurveyPretestPanel.vue";

// 发布确认与面板同款 Dialog 内联 stub：避免 PrimeVue 弹层 teleport 出测试树。
const DialogStub = defineComponent({
  name: "DialogStub",
  props: { visible: { type: Boolean, default: false } },
  setup(props, { slots }) {
    return () =>
      props.visible
        ? h("div", { class: "dialog-stub" }, [slots.default?.(), slots.footer?.()])
        : null;
  },
});

function mountPanel(props: {
  pretest?: SurveyResearchPretest | null;
  revisionId?: string;
  revisionNumber?: number | null;
  busy?: boolean;
} = {}) {
  const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const host = createTestHost({ notify });
  const wrapper = mountSurveysComponent(
    SurveyPretestPanel,
    {
      props: {
        visible: true,
        definition: makeDefinition(),
        pretest: props.pretest ?? null,
        revisionId: props.revisionId ?? "",
        revisionNumber: props.revisionNumber ?? null,
        busy: props.busy ?? false,
      },
      global: { stubs: { Dialog: DialogStub } },
    },
    host,
  );
  return { wrapper, notify };
}

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

async function fillEntry(
  wrapper: ReturnType<typeof mountPanel>["wrapper"],
  entry: { questionId: string; aspect: string; note: string; count?: number },
) {
  const inputs = wrapper.findAllComponents(InputNumber);
  const areas = wrapper.findAllComponents(Textarea);
  // 组件序：meta 段（人数、总备注）在前，表单段（题目、类型、备注、人数）在后。
  inputs[0]!.vm.$emit("update:modelValue", 3);
  areas[0]!.vm.$emit("update:modelValue", "总体有人反馈题干歧义");
  wrapper.findComponent(Select).vm.$emit("update:modelValue", entry.questionId);
  wrapper
    .findComponent(SelectButton)
    .vm.$emit("update:modelValue", entry.aspect);
  areas[1]!.vm.$emit("update:modelValue", entry.note);
  if (entry.count !== undefined) inputs[1]!.vm.$emit("update:modelValue", entry.count);
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "添加这条反馈")!
    .trigger("click");
  await flushPromises();
}

describe("SurveyPretestPanel", () => {
  it("复制访谈提纲：说明与逐题四条探查问题以纯文本进剪贴板", async () => {
    const { wrapper, notify } = mountPanel();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "复制访谈提纲")!
      .trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("试填提纲");
    expect(text).toContain("\n1. 单选\n");
    expect(text).toContain("请TA先用自己的话说说");
    expect(text).toContain("有没有想选「其他」却没有这一项");
    expect(notify.success).toHaveBeenCalledWith("提纲已复制");
    wrapper.unmount();
  });

  it("复制失败给可见警示，不假成功", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { wrapper, notify } = mountPanel();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "复制访谈提纲")!
      .trigger("click");
    await flushPromises();
    expect(notify.error).toHaveBeenCalledWith("复制失败，请手动选择文本复制。");
    expect(notify.success).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("按题添加反馈并保存：事件带人数/备注/版本与逐条反馈", async () => {
    const { wrapper } = mountPanel({ revisionId: "rev-1" });
    await fillEntry(wrapper, {
      questionId: "q1",
      aspect: "recall",
      note: "想不起上学期用过哪些",
      count: 2,
    });
    expect(wrapper.findAll(".pretest-entry")).toHaveLength(1);
    expect(wrapper.find(".pretest-entry").text()).toContain("第 1 题");
    expect(wrapper.find(".pretest-entry").text()).toContain("回忆");
    expect(wrapper.find(".pretest-entry").text()).toContain("2 人");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存试填反馈")!
      .trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [
        {
          participantCount: 3,
          notes: "总体有人反馈题干歧义",
          revisionId: "rev-1",
          itemFeedback: [
            { questionId: "q1", aspect: "recall", note: "想不起上学期用过哪些", count: 2 },
          ],
        },
      ],
    ]);
    wrapper.unmount();
  });

  it("人数未填时保存禁用；题目或备注缺失时不能添加反馈", async () => {
    const { wrapper } = mountPanel();
    const saveButton = () =>
      wrapper.findAll("button").find((button) => button.text() === "保存试填反馈")!;
    expect(saveButton().attributes("disabled")).toBeDefined();

    // 备注为空：添加按钮禁用，反馈不会悄悄丢掉备注。
    wrapper.findComponent(Select).vm.$emit("update:modelValue", "q1");
    await flushPromises();
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text() === "添加这条反馈")!
        .attributes("disabled"),
    ).toBeDefined();

    // 人数是唯一硬门槛（schema participantCount ≥ 1）：填了即可保存，总备注可选。
    wrapper.findAllComponents(InputNumber)[0]!.vm.$emit("update:modelValue", 2);
    await flushPromises();
    expect(saveButton().attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("保存禁用给明原因（人数缺失），禁用按钮明确置灰样式（走查 P1 复审）", async () => {
    const { wrapper } = mountPanel();
    expect(wrapper.text()).toContain("先填写试填人数，才能保存。");
    expect(wrapper.find(".pretest-save").classes()).toContain("pretest-save");

    wrapper.findAllComponents(InputNumber)[0]!.vm.$emit("update:modelValue", 2);
    await flushPromises();
    expect(wrapper.text()).not.toContain("先填写试填人数，才能保存。");
    wrapper.unmount();
  });

  it("版本标签用人读序数：未发布显示无版本说明（走查 P2）", async () => {
    const numbered = mountPanel({ revisionNumber: 2, revisionId: "rev-uuid" });
    expect(numbered.wrapper.text()).toContain("记录将绑定当前版本（第 2 版）");
    numbered.wrapper.unmount();

    const unpublished = mountPanel({ revisionNumber: null, revisionId: "" });
    expect(unpublished.wrapper.text()).toContain("问卷还没有发布版本，记录不带版本号。");
    unpublished.wrapper.unmount();
  });

  it("有未保存改动时关闭先确认：丢弃才关闭，继续编辑保留（走查 P1 复审）", async () => {
    const { wrapper } = mountPanel();
    const cancelButton = () =>
      wrapper.findAll("button").find((button) => button.text() === "取消")!;

    // 无改动：直接关闭，不打扰。
    await cancelButton().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:visible")).toEqual([[false]]);
    wrapper.unmount();

    // 填了人数即算改动：先出确认，不静默丢弃。
    const dirty = mountPanel();
    dirty.wrapper.findAllComponents(InputNumber)[0]!.vm.$emit("update:modelValue", 3);
    await flushPromises();
    await dirty.wrapper
      .findAll("button")
      .find((button) => button.text() === "取消")!
      .trigger("click");
    await flushPromises();
    expect(dirty.wrapper.emitted("update:visible")).toBeUndefined();
    expect(dirty.wrapper.text()).toContain("有未保存的试填反馈，关闭将丢弃。");

    // 继续编辑：不出确认、不关闭。
    await dirty.wrapper
      .findAll("button")
      .find((button) => button.text() === "继续编辑")!
      .trigger("click");
    await flushPromises();
    expect(dirty.wrapper.emitted("update:visible")).toBeUndefined();
    expect(dirty.wrapper.text()).not.toContain("有未保存的试填反馈，关闭将丢弃。");

    // 再点关闭并确认丢弃：这才真正关闭。
    await dirty.wrapper
      .findAll("button")
      .find((button) => button.text() === "取消")!
      .trigger("click");
    await flushPromises();
    await dirty.wrapper
      .findAll("button")
      .find((button) => button.text() === "丢弃并关闭")!
      .trigger("click");
    await flushPromises();
    expect(dirty.wrapper.emitted("update:visible")).toEqual([[false]]);
    dirty.wrapper.unmount();
  });

  it("既有记录回填：逐条可删，保存只带剩余条目；版本缺失时不带 revisionId", async () => {
    const pretest: SurveyResearchPretest = {
      participantCount: 4,
      notes: "两人反馈题干歧义",
      recordedAt: "2026-01-01T00:00:00.000Z",
      itemFeedback: [
        { questionId: "q1", aspect: "comprehension", note: "把「常用」理解成了每周", count: 2 },
        { questionId: "q2", aspect: "response", note: "想要的其他不在选项里" },
      ],
    };
    const { wrapper } = mountPanel({ pretest });
    expect(wrapper.findAll(".pretest-entry")).toHaveLength(2);

    await wrapper
      .findAll(".pretest-entry button")
      .find((button) => button.attributes("aria-label") === "删除这条反馈")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".pretest-entry")).toHaveLength(1);
    expect(wrapper.find(".pretest-entry").text()).toContain("多选");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存试填反馈")!
      .trigger("click");
    expect(wrapper.emitted("save")![0]![0]).toEqual({
      participantCount: 4,
      notes: "两人反馈题干歧义",
      itemFeedback: [{ questionId: "q2", aspect: "response", note: "想要的其他不在选项里" }],
    });
    wrapper.unmount();
  });
});
