// AI 建卷起点组件测试（issue #224 M3）：hero/compact 密度、sendPrompt 直发与
// fillComposer fallback、防重复提交、失败反馈与输入保留、未导航的如实提示、
// 无 copilot 宿主降级、次要动作 emit。交付帧与导航归页面，这里只断言桥调用。
import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveysWebHost } from "../host.js";

import SurveyCreateStart from "./SurveyCreateStart.vue";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

const IDEA = "了解研究生的科研工具使用情况";

interface CopilotSpies {
  sendPrompt?: ReturnType<typeof vi.fn>;
  fillComposer: ReturnType<typeof vi.fn<(text: string) => void>>;
  focusComposer: ReturnType<typeof vi.fn>;
}

function makeHost(copilot?: {
  sendPrompt?: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
}): {
  host: SurveysWebHost;
  spies: CopilotSpies;
} {
  const spies: CopilotSpies = {
    sendPrompt: copilot?.sendPrompt,
    fillComposer: vi.fn(),
    focusComposer: vi.fn(),
  };
  const host = createTestHost({
    ...(copilot
      ? {
          copilot: {
            registerHandlers: () => () => {},
            setContextRefs: () => {},
            fillComposer: spies.fillComposer,
            focusComposer: spies.focusComposer,
            ...(copilot.sendPrompt ? { sendPrompt: copilot.sendPrompt } : {}),
          } as never,
        }
      : {}),
  });
  return { host, spies };
}

function mountWithVariant(host: SurveysWebHost, variant: "hero" | "compact") {
  return mountSurveysComponent(SurveyCreateStart, { props: { variant } }, host);
}

describe("SurveyCreateStart（issue #224 M3）", () => {
  it("hero 态渲染主文案、输入与唯一主入口；compact 态不渲染长说明", () => {
    const { host } = makeHost();
    const hero = mountWithVariant(host, "hero");
    expect(hero.text()).toContain(t("surveys.createStart.question"));
    expect(hero.text()).toContain(t("surveys.createStart.hint"));
    expect(hero.find("textarea").exists()).toBe(true);
    expect(hero.findAll("button").map((b) => b.text())).toEqual([
      t("surveys.createStart.submit"),
      t("surveys.createStart.altTemplate"),
      t("surveys.createStart.altBlank"),
    ]);
    hero.unmount();

    const compact = mountWithVariant(makeHost().host, "compact");
    expect(compact.text()).toContain(t("surveys.createStart.question"));
    expect(compact.text()).not.toContain(t("surveys.createStart.hint"));
    compact.unmount();
  });

  it("入口层级（P1-10）：hero/compact 都是唯一主按钮 + 一条 muted 次级行含模板/空白两个链接", () => {
    for (const variant of ["hero", "compact"] as const) {
      const wrapper = mountWithVariant(makeHost().host, variant);
      // 主入口唯一：actions 区只有「生成问卷」。
      const actions = wrapper.findAll(".create-start-actions button");
      expect(actions).toHaveLength(1);
      expect(actions[0]!.text()).toBe(t("surveys.createStart.submit"));
      // 次级行：模板/空白两个文字链接，主按钮不在其中。
      const altLinks = wrapper.findAll(".create-start-alt button");
      expect(altLinks.map((b) => b.text())).toEqual([
        t("surveys.createStart.altTemplate"),
        t("surveys.createStart.altBlank"),
      ]);
      expect(wrapper.find(".create-start-alt").text()).toContain(t("surveys.createStart.altPrefix"));
      expect(wrapper.text()).toContain("/");
      wrapper.unmount();
    }
  });

  it("有 sendPrompt：点击生成直接发送包装后的研究想法", async () => {
    const sendPrompt = vi.fn<(text: string) => Promise<void>>(async () => {});
    const { host } = makeHost({ sendPrompt });
    const wrapper = mountWithVariant(host, "hero");
    await wrapper.find("textarea").setValue(IDEA);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!
      .trigger("click");
    await flushPromises();
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    const prompt = sendPrompt.mock.calls[0]![0];
    expect(prompt).toBe(t("surveys.copilot.createIdea", { idea: IDEA }));
    expect(prompt).toContain(IDEA);
    wrapper.unmount();
  });

  it("pending 期间防重复提交；resolve 且未导航时给如实提示（不伪造进度）", async () => {
    let release!: () => void;
    const sendPrompt = vi.fn<(text: string) => Promise<void>>(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { host } = makeHost({ sendPrompt });
    const wrapper = mountWithVariant(host, "hero");
    await wrapper.find("textarea").setValue(IDEA);
    const submit = () =>
      wrapper
        .findAll("button")
        .find((b) => b.text() === t("surveys.createStart.submit"))!;
    await submit().trigger("click");
    expect(submit().classes()).toContain("p-button-loading");
    await submit().trigger("click");
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    release();
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.createStart.noDelivery"));
    // 已发送态：同文案按钮禁用，连点不双发。
    expect(submit().attributes("disabled")).toBeDefined();
    await submit().trigger("click");
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    // 输入保留；修改描述即解锁，可重试。
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe(IDEA);
    await wrapper.find("textarea").setValue(IDEA + "（补充：面向一年级）");
    expect(submit().attributes("disabled")).toBeUndefined();
    await submit().trigger("click");
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    expect(sendPrompt.mock.calls[1]![0]).toContain("补充");
    wrapper.unmount();
  });

  it("无 sendPrompt：fillComposer + focusComposer，不发送", async () => {
    const { host, spies } = makeHost({});
    const wrapper = mountWithVariant(host, "hero");
    await wrapper.find("textarea").setValue(IDEA);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!
      .trigger("click");
    await flushPromises();
    expect(spies.fillComposer).toHaveBeenCalledTimes(1);
    expect(spies.fillComposer.mock.calls[0]![0]).toContain(IDEA);
    expect(spies.focusComposer).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain(t("surveys.createStart.failed"));
    wrapper.unmount();
  });

  it("sendPrompt 失败：显示失败反馈，输入保留，可重试", async () => {
    const sendPrompt = vi.fn<(text: string) => Promise<void>>(async () => {
      throw new Error("network");
    });
    const { host } = makeHost({ sendPrompt });
    const wrapper = mountWithVariant(host, "hero");
    await wrapper.find("textarea").setValue(IDEA);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.createStart.failed"));
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe(IDEA);

    sendPrompt.mockImplementation(async () => {});
    await wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain(t("surveys.createStart.failed"));
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("无 copilot 宿主：输入与主按钮禁用，给降级说明；次级行链接仍可用", async () => {
    const { host } = makeHost();
    const wrapper = mountWithVariant(host, "hero");
    expect(wrapper.text()).toContain(t("surveys.createStart.noCopilot"));
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();
    const submit = wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!;
    expect(submit.attributes("disabled")).toBeDefined();
    const picked = vi.fn();
    const blank = vi.fn();
    const withEmits = mountSurveysComponent(SurveyCreateStart, { props: { variant: "hero", onPickTemplate: picked, onCreateBlank: blank } }, host);
    await withEmits
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.altTemplate"))!
      .trigger("click");
    await withEmits
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.altBlank"))!
      .trigger("click");
    expect(picked).toHaveBeenCalledTimes(1);
    expect(blank).toHaveBeenCalledTimes(1);
    withEmits.unmount();
    wrapper.unmount();
  });

  it("空输入时主按钮禁用", () => {
    const { host } = makeHost({
      sendPrompt: vi.fn<(text: string) => Promise<void>>(async () => {}),
    });
    const wrapper = mountWithVariant(host, "hero");
    const submit = wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!;
    expect(submit.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
