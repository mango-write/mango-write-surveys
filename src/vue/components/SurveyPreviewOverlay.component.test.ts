// 预览弹层组件测试（issue #217）：每次打开都从头开始（consent 起步、答案
// 清空）、「重新预览」重置、手机档渲染 390 机身外框（状态栏暗示）。Dialog 以
// 内联 stub 渲染，避免 PrimeVue 弹层 teleport 到 body 后无法断言。
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";

import type { SurveyDefinition } from "../../contracts/index.js";
import SurveyPreviewOverlay from "./SurveyPreviewOverlay.vue";
import { mountSurveysComponent } from "../test-mount.js";

const DialogStub = defineComponent({
  name: "DialogStub",
  props: { visible: { type: Boolean, default: false } },
  setup(props, { slots }) {
    return () =>
      props.visible
        ? h("div", { class: "dialog-stub" }, [slots.default?.()])
        : null;
  },
});

function definition(): SurveyDefinition {
  return {
    version: 1,
    title: "研究问卷",
    description: "",
    consent: "",
    questions: [
      {
        id: "q1",
        type: "text",
        title: "备注",
        required: false,
        multiline: true,
      },
    ],
    pages: [{ id: "p1", title: "第 1 页", questionIds: ["q1"] }],
  };
}

// mountSurveysComponent 固定 zh-CN 文案；按钮文案直接断言中文字符串。
async function mountOverlay(visible: boolean) {
  const wrapper = mountSurveysComponent(
    SurveyPreviewOverlay,
    {
      props: { definition: definition(), visible },
      global: { stubs: { Dialog: DialogStub } },
    },
  );
  await flushPromises();
  return wrapper;
}

type OverlayWrapper = Awaited<ReturnType<typeof mountOverlay>>;
function startButton(wrapper: OverlayWrapper) {
  return wrapper
    .findAll("button")
    .find((b) => b.text().includes("开始填写"))!;
}
function restartButton(wrapper: OverlayWrapper) {
  return wrapper
    .findAll("button")
    .find((b) => b.text().includes("重新预览"))!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SurveyPreviewOverlay（issue #217）", () => {
  it("consent 两步流程：勾选同意只点亮「开始填写」，点击后才进第 1 页", async () => {
    const wrapper = await mountOverlay(true);
    const dialog = wrapper.find(".dialog-stub");
    expect(dialog.text()).toContain("研究问卷");
    const start = () => startButton(wrapper);
    expect(start().attributes("disabled")).toBeDefined();

    // 勾选同意：仍停在引导页，开始按钮点亮但未进入逐页流程。
    await dialog.find("input[type=checkbox]").setValue(true);
    await flushPromises();
    expect(start().attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".preview-questions").exists()).toBe(false);

    // 点「开始填写」才进第 1 页。
    await start().trigger("click");
    await flushPromises();
    expect(start()).toBeUndefined();
    expect(wrapper.find(".preview-questions textarea").exists()).toBe(true);
  });

  it("进入第 1 页作答后关闭重开，回到 consent 且答案清空", async () => {
    const wrapper = await mountOverlay(false);
    await wrapper.setProps({ visible: true });
    await flushPromises();
    const dialog = wrapper.find(".dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain("研究问卷");
    expect(startButton(wrapper).attributes("disabled")).toBeDefined();

    // 勾同意 → 开始 → 第 1 页填入文本。
    await dialog.find("input[type=checkbox]").setValue(true);
    await startButton(wrapper).trigger("click");
    await flushPromises();
    const answer = wrapper.find(".preview-questions textarea");
    expect(answer.exists()).toBe(true);
    await answer.setValue("草稿答案");

    // 关闭 → 重开：回到 consent、作答清空（开始按钮重新禁用）。
    await wrapper.setProps({ visible: false });
    await flushPromises();
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(startButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("「重新预览」重置到 consent", async () => {
    const wrapper = await mountOverlay(true);
    await wrapper.find("input[type=checkbox]").setValue(true);
    await startButton(wrapper).trigger("click");
    await flushPromises();
    expect(startButton(wrapper)).toBeUndefined(); // 已进入第 1 页，没有开始按钮

    await restartButton(wrapper).trigger("click");
    await flushPromises();
    expect(startButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("手机档渲染 390 机身外框与状态栏暗示；桌面档没有", async () => {
    const wrapper = await mountOverlay(true);
    expect(wrapper.find(".preview-device--phone").exists()).toBe(false);

    const mobile = wrapper
      .findAll("button")
      .find((b) => b.text().includes("手机"))!;
    await mobile.trigger("click");
    await flushPromises();
    const phone = wrapper.find(".preview-device--phone");
    expect(phone.exists()).toBe(true);
    expect(phone.find(".preview-device__statusbar").exists()).toBe(true);
    expect(phone.find(".preview-paper--phone").exists()).toBe(true);
  });
});
