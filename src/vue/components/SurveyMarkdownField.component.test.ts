// SurveyMarkdownField 的路径选择（#223 review）：宿主带富文本往返转换器时用
// TipTap；缺省时 textarea 直编 markdown 源文本（进出无转换）；disabled 才只读。
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import { createTestHost, mountSurveysComponent } from "../test-mount.js";
import SurveyMarkdownField from "./SurveyMarkdownField.vue";

describe("SurveyMarkdownField 编辑路径", () => {
  it("宿主缺往返转换器：textarea 直编 markdown，输入即 change、失焦 commit", async () => {
    const wrapper = mountSurveysComponent(SurveyMarkdownField, {
      props: { modelValue: "原有说明" },
    });
    const textarea = wrapper.find("textarea");
    expect(textarea.exists()).toBe(true);
    expect((textarea.element as HTMLTextAreaElement).value).toBe("原有说明");

    await textarea.setValue("改后的**说明**");
    expect(wrapper.emitted("change")?.at(-1)).toEqual(["改后的**说明**"]);
    await textarea.trigger("blur");
    expect(wrapper.emitted("commit")).toHaveLength(1);
  });

  it("disabled：只读渲染，无输入面", () => {
    const wrapper = mountSurveysComponent(SurveyMarkdownField, {
      props: { modelValue: "**只读**", disabled: true },
    });
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find(".survey-markdown-field__readonly").exists()).toBe(true);
  });

  it("宿主带转换器：富文本编辑面", async () => {
    const host = createTestHost({
      renderMarkdownEditable: (source: string) => `<p>${source}</p>`,
      htmlToMarkdown: (html: string) => html,
    } as never);
    // tiptap 编辑器经 onMounted 异步建实例（jsdom 需 attachTo + 多轮 tick）。
    const wrapper = mountSurveysComponent(
      SurveyMarkdownField,
      { props: { modelValue: "富文本" }, attachTo: document.body },
      host,
    );
    expect(wrapper.find("textarea").exists()).toBe(false);
    for (let i = 0; i < 5; i += 1) await nextTick();
    expect(wrapper.find(".ProseMirror").exists()).toBe(true);
    wrapper.unmount();
  });
});
