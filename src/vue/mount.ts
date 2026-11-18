// Framework-agnostic mount seam for embedding survey Vue widgets inside non-Vue hosts (e.g. dsh React right-rail tabs).
import { createApp, defineComponent, h, shallowRef, type App, type Component, type Plugin } from "vue";
import { createI18n, type I18nOptions } from "vue-i18n";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { uiMessages, vScrollFade, vTooltip } from "@mango-write/ui-vue";
import { provideConfirm } from "@mango-write/ui-vue/lib/confirm";
import { provideNotify } from "@mango-write/ui-vue/lib/notify";

import { surveysMessages } from "./locale/index.js";
import { SurveysHostKey, type SurveysWebHost } from "./host.js";
import { SurveysResearchPanelKey } from "./research-host.js";

export type SurveysHost = SurveysWebHost;
export type { SurveysWebHost };

export interface MountSurveyWidgetOptions<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  host: SurveysHost;
  component: Component;
  props?: P;
  locale?: "zh-CN" | "en-US";
  initialPath?: string;
  router?: Router;
  researchPanel?: Component;
  plugins?: readonly Plugin[];
}

export interface MountedSurveyWidget<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  updateProps(nextProps: P): void;
  dispose(): void;
}

const EmptyRouteView = defineComponent({
  name: "SurveysMountRouteFallback",
  render: () => null,
});

function createDefaultWidgetRouter(initialPath: string): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/surveys", name: "surveys.list", component: EmptyRouteView },
      { path: "/surveys/:surveyId", name: "surveys.detail", component: EmptyRouteView },
      { path: "/s/:slug", name: "surveys.public", component: EmptyRouteView },
      { path: "/:pathMatch(.*)*", name: "surveys.fallback", component: EmptyRouteView },
    ],
  });
  void router.replace(initialPath);
  return router;
}

export function mountSurveyWidget<
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  container: HTMLElement,
  options: MountSurveyWidgetOptions<P>,
): MountedSurveyWidget<P> {
  const propsRef = shallowRef<Record<string, unknown>>({ ...(options.props ?? {}) });
  const Root = defineComponent({
    name: "MountedSurveyWidgetRoot",
    setup() {
      return () => h(options.component, propsRef.value);
    },
  });

  const app: App = createApp(Root);
  const i18n = createI18n({
    legacy: false,
    locale: options.locale ?? "zh-CN",
    fallbackLocale: "en-US",
    messages: {
      "zh-CN": { ...surveysMessages["zh-CN"], common: uiMessages["zh-CN"].common },
      "en-US": { ...surveysMessages["en-US"], common: uiMessages["en-US"].common },
    },
  } as unknown as I18nOptions);

  const inferredPath =
    options.initialPath ??
    (typeof options.props?.surveyId === "string" && options.props.surveyId
      ? `/surveys/${encodeURIComponent(options.props.surveyId)}`
      : "/surveys");
  const router = options.router ?? createDefaultWidgetRouter(inferredPath);

  provideConfirm(app);
  provideNotify(app);
  app.directive("tooltip", vTooltip);
  app.directive("scroll-fade", vScrollFade);
  app.provide(SurveysHostKey, options.host);
  if (options.researchPanel) {
    app.provide(SurveysResearchPanelKey, options.researchPanel);
  }
  app.use(i18n);
  app.use(router);
  for (const plugin of options.plugins ?? []) {
    app.use(plugin);
  }

  app.mount(container);

  let disposed = false;
  return {
    updateProps(nextProps: P) {
      if (disposed) return;
      propsRef.value = { ...nextProps };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      app.unmount();
      container.replaceChildren();
    },
  };
}
