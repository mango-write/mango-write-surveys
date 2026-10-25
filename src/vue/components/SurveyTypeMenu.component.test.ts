// 题型菜单的 role=menu 键盘义务（issue #217 minor⑤）：方向键在 menuitem 间移动
// 焦点，Home/End 跳首尾；Enter/Space 是原生按钮行为不接管。滚动渐隐依赖真实
// 布局（jsdom 无 scrollHeight），由浏览器验证覆盖，这里只钉焦点管理。
import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { createI18n } from "vue-i18n";

import SurveyTypeMenu from "./SurveyTypeMenu.vue";
import messages from "../locale/en-US.js";

async function render() {
  // attachTo：焦点管理是本组件的键盘义务，脱离文档树 focus() 不生效。
  const wrapper = mount(SurveyTypeMenu, {
    props: { open: true },
    attachTo: document.body,
    global: {
      plugins: [
        PrimeVue,
        createI18n({
          legacy: false,
          locale: "en",
          messages: { en: { surveys: messages } },
        }),
      ],
      // v-tooltip 指令（菜单宿主面）在测试环境不注册，本组件模板未用到即可。
    },
  });
  await flushPromises();
  return wrapper;
}

function items(wrapper: Awaited<ReturnType<typeof render>>) {
  return wrapper.findAll(".type-item");
}

function focusedLabel(): string | null {
  return (
    (document.activeElement as HTMLElement | null)?.querySelector("strong")
      ?.textContent ??
    (document.activeElement as HTMLElement | null)?.textContent?.slice(0, 24) ??
    null
  );
}

describe("SurveyTypeMenu 方向键导航（issue #217 minor⑤）", () => {
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it("ArrowDown 依次后移，ArrowUp 回退", async () => {
    const wrapper = await render();
    const list = items(wrapper);
    expect(list.length).toBe(18);
    (list[0]!.element as HTMLElement).focus();
    await list[0]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(list[1]!.element);
    await list[1]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(list[2]!.element);
    await list[2]!.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(list[1]!.element);
    wrapper.unmount();
  });

  it("末项 ArrowDown 环绕回首项；Home/End 跳首尾", async () => {
    const wrapper = await render();
    const list = items(wrapper);
    const last = list[list.length - 1]!;
    (last.element as HTMLElement).focus();
    await last.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(list[0]!.element);
    await list[0]!.trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(last.element);
    await last.trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(list[0]!.element);
    wrapper.unmount();
  });

  it("焦点不在菜单内时不响应方向键（不抢宿主焦点）", async () => {
    const wrapper = await render();
    const list = items(wrapper);
    await wrapper.find(".survey-type-menu").trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(list[1]!.element);
    wrapper.unmount();
  });

  it("Esc 关闭菜单（全局 keydown 捕获）", async () => {
    const wrapper = await render();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
});
