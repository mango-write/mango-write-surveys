// 问卷前端的宿主契约：包不 import 宿主代码，全部宿主能力经 provide/inject 注入。
// 主站与独立站各实现一份 SurveysWebHost；组件经 useSurveysHost() 取用，缺失即
// 宿主装配错误（直接抛错，不静默降级成无样式/无文案的假可用）。
import { inject, ref } from "vue";
import type { Component, InjectionKey, Ref } from "vue";

import type { ToolSurveyDelivery } from "../contracts/index.js";

/** 包内唯一错误面：宿主传输层把非 2xx 归一为它（等价主站 ApiError 的消费语义）。 */
export class SurveysApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: unknown,
  ) {
    super(code);
    this.name = "SurveysApiError";
  }
}

export interface SurveysTransport {
  /** JSON / FormData 请求。非 2xx 抛 SurveysApiError；认证 cookie、租户头、
   *  baseUrl、CSRF 等全部由宿主实现持有，包不感知。 */
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  /** 字节下载（CSV/变量字典导出）：宿主负责触发浏览器下载与文件名落盘。 */
  download?(path: string, filename: string): Promise<void>;
  /** 卸载瞬间（pagehide）的 keepalive 同步落盘：宿主带自己的认证/租户头立即
   *  发出、不等响应。缺省 = 该宿主不支持（放弃本次未落盘内容）。 */
  beacon?(path: string, body: unknown): void;
}

/** 空间感知导航目标（主站经 spaceLink 生成 u./t. 前缀；独立站映射自己的路由）。 */
export type SurveysRouteTarget =
  | { name: "surveys.list" }
  | { name: "surveys.detail"; surveyId: string }
  | { name: "surveys.public"; slug: string };

export interface SurveysNotify {
  success(detail: string): void;
  error(detail: string): void;
  info(detail: string): void;
  /** 警示级（软失败提示）。缺省由 useSurveysNotify 回落 error。 */
  warn?(detail: string): void;
}

/** 问卷页写入右岛的上下文锚点（包内窄型；宿主适配成自己的 ContextRef）。 */
export interface SurveysCopilotContextRef {
  kind: "survey-question" | "survey-page";
  refId: string;
  snippet?: string;
}

/** 页面按需注册的交付帧处理；宿主桥按 surface（资源 + 登记代次）路由帧。 */
export interface SurveysCopilotHandlers {
  /** survey_edit 由工作区页重放 ops，survey_create 由收帧页导航。 */
  onSurveyDeliveryFrame?: (delivery: ToolSurveyDelivery) => void;
}

/** 问卷页写入右岛的承载资源；卸载/换卷后迟到的帧据此拒收。 */
export interface SurveysCopilotSurface {
  kind: "survey";
  id: string;
}

/** 页面配置的 Copilot 面板场景动作。结构与主仓通用契约（CopilotSurfaceAction）
 *  一致的判别联合：prompt 分支走宿主既有发送管线（sendAgentEdit 同源，
 *  toolNames 收窄）；run 分支是页面本地回调，返回 Promise 让宿主可跟踪完成。
 *  至多一个 primary，面板不做强制。 */
export type SurveysCopilotSurfaceAction =
  | {
      /** 页面内稳定的 id（渲染 key 与测试定位用），不需要跨页全局唯一。 */
      id: string;
      label: string;
      primary?: boolean;
      /** 点击后作为消息内容发送的 prompt（不写入 composer）。 */
      prompt: string;
      skillId?: string;
      toolNames?: string[];
      run?: never;
    }
  | {
      id: string;
      label: string;
      primary?: boolean;
      prompt?: never;
      toolNames?: never;
      /** 页面本地回调：由页面自律保证幂等/防重（如经 reviewSession 的 busy 闸）；
       *  透出返回的 Promise，宿主可跟踪动作完成。 */
      run: () => void | Promise<void>;
    };

/** 页面对常驻 Copilot 面板空态与输入区的呈现配置（包内窄型；宿主适配成自己的
 *  CopilotSurfacePresentation）。全部字段可选，未配置的回落面板默认。 */
export interface SurveysCopilotSurfacePresentation {
  title?: string;
  description?: string;
  /** 覆盖 composer 的输入占位文案（页面自备 i18n 后的字符串）。 */
  composerPlaceholder?: string;
  actions?: SurveysCopilotSurfaceAction[];
}

/** 右栏 Copilot 岛的最小注入面：包页面只经它 emit/登记，不感知岛内部。 */
export interface SurveysCopilotHost {
  /** 右栏岛组件（宿主持有单实例与 scope 切换）；缺省 = 该宿主没有 Copilot，
   *  包工作台不出右栏、AI 入口按钮 no-op。 */
  island?: Component;
  /** 登记交付帧处理，返回注销函数（页面 onUnmounted 调用）。 */
  registerHandlers(
    handlers: SurveysCopilotHandlers,
    opts?: { surface?: () => SurveysCopilotSurface | null },
  ): () => void;
  /** 选中题/页等上下文锚点（ambient，随每轮消息注入）。 */
  setContextRefs(refs: SurveysCopilotContextRef[]): void;
  /** 预填对话输入框并聚焦（列表页「AI 生成」入口）。 */
  fillComposer(text: string): void;
  focusComposer(): void;
  sendPrompt?(text: string, toolNames?: string[], options?: { skillId?: string }): Promise<void>;
  /** 页面按 scope 注册面板呈现（空态文案/场景动作/composer 占位）；undefined =
   *  清除。换 scope/换页由页面重新注册；页面卸载后的清理归 releasePageState。
   *  缺省 = 该宿主不消费 surface 呈现（页面照常工作）。 */
  setSurfacePresentation?(presentation: SurveysCopilotSurfacePresentation | undefined): void;
  /** 页面卸载时清掉它写进桥的状态（含 surface 呈现）——桥是宿主单例，不清会
   *  把上一页的空态/动作漏给下一页。 */
  releasePageState(): void;
}

export interface SurveysLayoutDefaults {
  activeLeftTab: string;
  leftRailWidth: number;
  rightRailWidth: number;
}

/** 按面布局偏好（左右栏宽 / 左岛 tab 记忆）。宿主实现负责持久化；缺省用包内
 *  本地 reactive 单例（会话内有效，不持久化）。 */
export interface SurveysLayoutPrefs {
  activeLeftTab: Ref<string>;
  leftRailWidth: Ref<number>;
  rightRailWidth: Ref<number>;
  leftCollapsed: Ref<boolean>;
  ready: Ref<boolean>;
}

export type SurveysLayoutPrefsHost = (
  surface: string,
  defaults: SurveysLayoutDefaults,
) => SurveysLayoutPrefs;

export interface SurveysWebHost {
  workbenchShell?: Component;
  transport: SurveysTransport;
  notify: SurveysNotify;
  navigate(to: SurveysRouteTarget): void;
  /** 安全 Markdown 渲染（说明块/知情同意/研究说明）。宿主持唯一安全口径
   *  （html:false + 链接协议白名单），包内不自建第二套渲染器。 */
  renderMarkdown(source: string): string;
  /** 富文本粘贴 HTML → Markdown；缺省时禁用粘贴转换，不降级为裸文本塞入。 */
  htmlToMarkdown?(html: string): string;
  /** 编辑面 Markdown → HTML（round-trip 安全：不消耗待编辑语法，数学/任务
   *  列表/脚注关闭）。与 htmlToMarkdown 成对提供才启用富文本编辑；缺省时
   *  说明类字段降级为 textarea 直编 markdown 源文本（安全等价，无 HTML 往返）。 */
  renderMarkdownEditable?(source: string): string;
  /** 工作台三岛布局记忆（左右栏宽/折叠、按面 tab）。缺省本地 reactive 不持久化。 */
  layoutPrefs?: SurveysLayoutPrefsHost;
  /** 右栏 Copilot 岛（缺省 = 无 Copilot 的宿主）。 */
  copilot?: SurveysCopilotHost;
}

export const SurveysHostKey: InjectionKey<SurveysWebHost> = Symbol("surveys-web-host");

export function useSurveysHost(): SurveysWebHost {
  const host = inject(SurveysHostKey);
  if (!host) {
    throw new Error("SurveysWebHost not injected: host must provide(SurveysHostKey, ...) at app bootstrap");
  }
  return host;
}

// ── 布局偏好缺省实现：包内本地单例（不持久化）────────────────────────────
const localPrefs: SurveysLayoutPrefs = {
  activeLeftTab: ref(""),
  leftRailWidth: ref(300),
  rightRailWidth: ref(360),
  leftCollapsed: ref(false),
  ready: ref(true),
};
let localSeeded = false;

/** 工作台布局偏好统一入口：宿主实现了 layoutPrefs 就交给它（持久化），
 *  否则回落包内本地单例。同一宿主内多次调用共享同一份 ref。 */
export function useSurveysLayoutPrefs(defaults: SurveysLayoutDefaults): SurveysLayoutPrefs {
  const prefs = inject(SurveysHostKey)?.layoutPrefs?.("surveys", defaults);
  if (prefs) return prefs;
  if (!localSeeded) {
    localSeeded = true;
    localPrefs.activeLeftTab.value = defaults.activeLeftTab;
    localPrefs.leftRailWidth.value = defaults.leftRailWidth;
    localPrefs.rightRailWidth.value = defaults.rightRailWidth;
  }
  return localPrefs;
}
