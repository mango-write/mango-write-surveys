// 包内组件测试的最小挂载：i18n（含包自持 surveys 文案）+ ui confirm/notify + ui 主题面。
// 宿主注入的 host 能力（transport/notify/navigate/renderMarkdown）由用例按需
// provide，缺省值用 no-op 实现，断言交互的用例传 spy。
import { mount } from "@vue/test-utils";
import type { App, Component } from "vue";
import { createI18n, type I18nOptions } from "vue-i18n";

import { uiMessages, vTooltip } from "@mango-write/ui";
import { provideConfirm } from "@mango-write/ui/lib/confirm";
import { provideNotify } from "@mango-write/ui/lib/notify";

import { surveysMessages } from "./locale/index.js";
import {
  SurveysHostKey,
  type SurveysNotify,
  type SurveysRouteTarget,
  type SurveysWebHost,
} from "./host.js";

/** 非组件测试（lib/composables）的独立 i18n 实例：与 mountSurveysComponent 同一份
 *  surveys 文案，供 t 键断言（宿主聚合场景键恒在 surveys.* 命名空间下）。
 *  locale 固定 zh-CN（包内测试约定）：主站 dom 档实际跑 en，按文案找 UI 项的
 *  用例在包内要用 zh 词面下无歧义的匹配键（如 typeHint 而非 type）。 */
export function createSurveysTestI18n() {
  return createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      "zh-CN": { ...surveysMessages["zh-CN"], common: uiMessages["zh-CN"].common },
      "en-US": { ...surveysMessages["en-US"], common: uiMessages["en-US"].common },
    },
  } as unknown as I18nOptions);
}

export function createTestHost(overrides: Partial<SurveysWebHost> = {}): SurveysWebHost {
  const noopNotify: SurveysNotify = {
    success: () => {},
    error: () => {},
    info: () => {},
  };
  return {
    transport: {
      request: (() => Promise.reject(new Error("transport not provided in this test"))) as never,
      ...overrides.transport,
    },
    notify: { ...noopNotify, ...(overrides.notify ?? {}) },
    navigate: overrides.navigate ?? ((_to: SurveysRouteTarget) => {}),
    renderMarkdown: overrides.renderMarkdown ?? ((source: string) => source),
    ...overrides,
  };
}

export function mountSurveysComponent(
  component: Component,
  options: Record<string, unknown> = {},
  host: SurveysWebHost = createTestHost(),
) {
  const i18n = createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      "zh-CN": { ...surveysMessages["zh-CN"], common: uiMessages["zh-CN"].common },
      "en-US": { ...surveysMessages["en-US"], common: uiMessages["en-US"].common },
    },
  } as unknown as I18nOptions);
  const userGlobal = (options.global as Record<string, unknown>) ?? {};
  const userPlugins = (userGlobal.plugins as unknown[]) ?? [];
  const rawStubs = userGlobal.stubs as Record<string, unknown> | unknown[] | undefined;
  const normalizedStubs =
    rawStubs && !Array.isArray(rawStubs)
      ? {
          ...rawStubs,
          ...(rawStubs.Dialog && !rawStubs.MwDialog ? { MwDialog: rawStubs.Dialog } : {}),
          ...(rawStubs.Popover && !rawStubs.MwPopover ? { MwPopover: rawStubs.Popover } : {}),
          ...(rawStubs.Select && !rawStubs.MwSelect ? { MwSelect: rawStubs.Select } : {}),
          ...(rawStubs.Menu && !rawStubs.MwMenu ? { MwMenu: rawStubs.Menu } : {}),
          ...(rawStubs.DataTable && !rawStubs.MwDataTable ? { MwDataTable: rawStubs.DataTable } : {}),
        }
      : rawStubs;
  return mount(component, {
    ...options,
    global: {
      ...userGlobal,
      ...(normalizedStubs !== undefined ? { stubs: normalizedStubs as never } : {}),
      directives: {
        // v-tooltip：宿主 app 全局注册，测试挂载默认补齐，组件模板里的 v-tooltip 才不告警。
        tooltip: vTooltip,
        ...((userGlobal.directives as Record<string, unknown>) ?? {}),
      },
      provide: {
        ...((userGlobal.provide as Record<string, unknown>) ?? {}),
        [SurveysHostKey as symbol]: host,
      },
      plugins: (
        [
          {
            install(app: App) {
              provideConfirm(app);
              provideNotify(app);
            },
          },
          i18n,
          ...userPlugins,
        ] as never[]
      ).flat() as never,
    },
  });
}
