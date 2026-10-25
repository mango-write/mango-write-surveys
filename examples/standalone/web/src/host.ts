// 独立站 SurveysWebHost 实现：把包前端契约接到本站基建——transport = 同源
// fetch（管理面带会话 cookie；公开面 omit + no-store，与主站口径一致）；
// notify = PrimeVue Toast（实例由 App.vue 在 setup 内取，经工厂注入）；
// navigate = 本站路由三元映射；markdown = 本站唯一安全渲染口径（html:false、
// linkify 关、http(s)/mailto 白名单），不与主站共享代码。layoutPrefs 走包内
// 本地回落；copilot = 最小 AI 建卷桥（App 级浮动面板，交付帧经包页注册的
// 处理链）；htmlToMarkdown / beacon 不注入（说明字段按包契约降级 textarea
// 直编，pagehide 兜底落盘禁用）。
import MarkdownIt from "markdown-it";
import type { ToastServiceMethods } from "primevue/toastservice";
import type { Router } from "vue-router";

import {
  SurveysApiError,
  type SurveysCopilotHost,
  type SurveysNotify,
  type SurveysRouteTarget,
  type SurveysWebHost,
} from "@mango-write/surveys/vue";

import { markSignedOut } from "./session";

// http(s)/mailto 之外一律降级为 # 并标记（与主站 renderSafeMarkdown 同口径的
// 独立实现）：markdown-it 自带的 validateLink 已挡 javascript: 等，这里再加白名单。
const SAFE_HREF = /^(?:https?:|mailto:)/i;

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

md.renderer.rules.link_open = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx]!;
  const href = String(token.attrGet("href") ?? "");
  if (!SAFE_HREF.test(href)) {
    token.attrSet("href", "#");
    token.attrSet("data-blocked-href", href);
  } else {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return self.renderToken(tokens, idx, _options);
};

function navigate(router: Router, to: SurveysRouteTarget): void {
  if (to.name === "surveys.list") {
    void router.push({ name: "surveys.list" });
  } else if (to.name === "surveys.detail") {
    void router.push({ name: "surveys.detail", params: { surveyId: to.surveyId } });
  } else {
    void router.push({ name: "surveys.public", params: { slug: to.slug } });
  }
}

export function createWebHost(
  router: Router,
  toast: ToastServiceMethods,
  copilot?: SurveysCopilotHost,
): SurveysWebHost {
  const notify: SurveysNotify = {
    success: (detail) => toast.add({ severity: "success", detail, life: 3000 }),
    error: (detail) => toast.add({ severity: "error", detail, life: 5000 }),
    info: (detail) => toast.add({ severity: "info", detail, life: 3000 }),
    warn: (detail) => toast.add({ severity: "warn", detail, life: 4000 }),
  };

  return {
    transport: {
      async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
        const isPublic = path.startsWith("/api/survey-public");
        const hasBody = init?.body !== undefined;
        const response = await fetch(path, {
          method: init?.method ?? (hasBody ? "POST" : "GET"),
          credentials: isPublic ? "omit" : "include",
          cache: isPublic ? "no-store" : undefined,
          headers:
            hasBody && !(init?.body instanceof FormData)
              ? { "Content-Type": "application/json" }
              : undefined,
          body: hasBody
            ? init?.body instanceof FormData
              ? init.body
              : JSON.stringify(init?.body)
            : undefined,
        });
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          // 会话过期：清本地标记并送回登录页（当前页的报错 toast 仍会弹出）。
          if (response.status === 401 && !isPublic) {
            markSignedOut();
            void router.push({ name: "login" });
          }
          throw new SurveysApiError(response.status, "request_failed", value);
        }
        return value as T;
      },
      async download(path: string, filename: string): Promise<void> {
        const response = await fetch(path, { credentials: "include" });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new SurveysApiError(response.status, "download_failed", body);
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    },
    notify,
    navigate: (to) => navigate(router, to),
    renderMarkdown: (source) => md.render(source ?? ""),
    ...(copilot ? { copilot } : {}),
  };
}
