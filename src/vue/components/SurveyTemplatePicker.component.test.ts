// 模板选择弹层组件用例：清单渲染、大纲预览展开/收起、选中后 emit select。
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";

import { mountSurveysComponent, createSurveysTestI18n } from "../test-mount.js";
import SurveyTemplatePicker from "./SurveyTemplatePicker.vue";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params ?? {});

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

async function mountPicker(visible = true) {
  const wrapper = mountSurveysComponent(
    SurveyTemplatePicker,
    {
      props: { visible, busy: false },
      global: { stubs: { Dialog: DialogStub } },
    },
  );
  await flushPromises();
  return wrapper;
}

describe("SurveyTemplatePicker（issue #217）", () => {
  it("visible=false 时不渲染弹层内容", async () => {
    const wrapper = await mountPicker(false);
    expect(wrapper.find(".dialog-stub").exists()).toBe(false);
    wrapper.unmount();
  });

  it("列出全部模板：名称、页数/题数、场景一行不缺", async () => {
    const wrapper = await mountPicker();
    const cards = wrapper.findAll(".template-card");
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(wrapper.text()).toContain(t("surveys.templates.sus.name"));
    expect(wrapper.text()).toContain(
      t("surveys.templates.metaLine", { pages: 1, questions: 1 }),
    );
    expect(wrapper.text()).toContain(t("surveys.templates.sceneLabel"));
    wrapper.unmount();
  });

  it("点卡片展开只读题目大纲，再点收起", async () => {
    const wrapper = await mountPicker();
    expect(wrapper.find(".template-outline").exists()).toBe(false);
    await wrapper.findAll(".template-card")[0]!.trigger("click");
    await flushPromises();
    const outline = wrapper.find(".template-outline");
    expect(outline.exists()).toBe(true);
    // 大纲是题目文字 + 题型标注，不是完整渲染（没有输入控件）。
    expect(outline.find("input").exists()).toBe(false);
    expect(outline.text()).toContain(t("surveys.templates.previewLabel"));
    expect(outline.text()).toContain(t("surveys.type.matrix_single"));
    await wrapper.findAll(".template-card")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".template-outline").exists()).toBe(false);
    wrapper.unmount();
  });

  it("未选中时「使用此模板」禁用；选中后 emit select 携带定义", async () => {
    const wrapper = await mountPicker();
    const use = () =>
      wrapper
        .findAll("button")
        .find((b) => b.text() === t("surveys.templates.use"))!;
    expect(use().attributes("disabled")).toBeDefined();
    await wrapper.findAll(".template-card")[1]!.trigger("click");
    await flushPromises();
    expect(use().attributes("disabled")).toBeUndefined();
    await use().trigger("click");
    await flushPromises();
    const emitted = wrapper.emitted("select");
    expect(emitted).toHaveLength(1);
    const template = emitted![0]![0] as { id: string; definition: unknown };
    expect(template.id).toBe("sus");
    expect(template.definition).toMatchObject({ version: 1, title: t("surveys.templates.sus.name") });
    wrapper.unmount();
  });
});
