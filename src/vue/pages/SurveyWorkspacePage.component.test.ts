// 工作区组件测试（issue #217）：生命周期轨道门控、发布链路（flush → 确认 →
// 发布 → 落发放段）、dirty 徽标（contentHash 同源比对）、自动保存防抖与状态、
// 409 冲突终态、撤销/重做接线、离开保护（先落盘后放行；落不了盘才拦）。
// 宿主能力全部经 createTestHost 注入：transport 按 path/method 分发到 api mocks
// （断言形状与旧 surveysApi mock 保持一致），navigate/beacon 用 spy。
import { defineComponent, h, useSlots, type Component } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createHash } from "node:crypto";

import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveysWebHost } from "../host.js";
import { SurveysApiError } from "../host.js";
import { canonicalSurveyJson } from "../../core/index.js";
import type { SurveyDefinition, SurveyDetail } from "../../contracts/index.js";
import {
  __resetAiCreatedSurveyHandoffForTest,
  setAiCreatedSurveyHandoff,
  takeAiCreatedSurveyHandoff,
  type AiCreatedSurveyHandoff,
} from "../lib/ai-created-handoff.js";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  status: vi.fn(),
  remove: vi.fn(),
}));

// confirm 全 mock：ConfirmDialog 不 teleport 进测试树，require 只收回调。
const confirmMocks = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("primevue/useconfirm", () => ({
  useConfirm: () => ({ require: confirmMocks.require }),
}));

import SurveyWorkspacePage from "./SurveyWorkspacePage.vue";
import SurveyVersionsPanel from "../components/SurveyVersionsPanel.vue";
import SurveyResearchAssistant from "../components/SurveyResearchAssistant.vue";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

interface PatchBody {
  expectedVersion?: number;
  definition?: unknown;
  responseLimit?: number;
  status?: string;
}

/** transport 按 path/method 分发到 api mocks：GET/PATCH/POST(publish|status)/DELETE。 */
function makeHost(
  opts: { beacon?: (path: string, body: unknown) => void; copilot?: boolean } = {},
): {
  host: SurveysWebHost;
  navigate: ReturnType<typeof vi.fn>;
  copilotRegister?: ReturnType<typeof vi.fn>;
} {
  const navigate = vi.fn();
  const copilotRegister = opts.copilot
      ? vi.fn(() => () => {})
      : undefined;
  const host = createTestHost({
    ...(copilotRegister ? { copilot: {
          registerHandlers: copilotRegister,
          setContextRefs: vi.fn(),
          releasePageState: vi.fn(),
        } as never } : {}),
    transport: {
      ...(opts.beacon ? { beacon: opts.beacon } : {}),
      request: (async (path: string, init?: { method?: string; body?: unknown }) => {
        const method = init?.method ?? "GET";
        const body = (init?.body ?? {}) as PatchBody;
        const segments = path.split("/").filter(Boolean);
        if (method === "GET") return mocks.get(segments.at(-1)!);
        if (method === "PATCH")
          return mocks.save(
            segments.at(-1)!,
            body.expectedVersion,
            body.definition,
            body.responseLimit,
          );
        if (method === "POST" && path.endsWith("/publish"))
          return mocks.publish(segments.at(-2)!);
        if (method === "POST" && path.endsWith("/status"))
          return mocks.status(segments.at(-2)!, body.status);
        if (method === "DELETE") return mocks.remove(segments.at(-1)!);
        throw new Error(`用例未覆盖的 transport 请求：${method} ${path}`);
      }) as never,
    },
    navigate: navigate as never,
  });
  return { host, navigate, copilotRegister };
}

const ShellStub = (activeTab: string) =>
  defineComponent({
    name: "SurveyWorkbenchShell",
    props: { tabs: { type: Array, default: () => [] } },
    setup() {
      const slots = useSlots();
      return () =>
        h("div", { class: "workbench-shell-stub" }, [
          h("div", { class: "stub-left" }, slots.left?.({ activeTab })),
          h("div", { class: "stub-center" }, slots.center?.()),
        ]);
    },
  });
const CanvasStub = defineComponent({
  name: "SurveyDesignCanvas",
  props: ["modelValue", "disabled", "activeQuestionId", "surveyId"],
  emits: ["change", "select"],
  methods: {
    locateIssue: () => {},
    // 每次点击提交一次定义变更（标题追加「!」），驱动历史栈/自动保存。
    appendTitle() {
      this.$emit("change", {
        ...this.modelValue,
        title: (this.modelValue.title || "") + "!",
      });
    },
    // 带目标 label 的题目编辑：撤销粒度与 undo/autosave 时序测试用。
    editQuestion(id: string, title: string) {
      this.$emit(
        "change",
        {
          ...this.modelValue,
          questions: this.modelValue.questions.map((q: { id: string }) =>
            q.id === id ? { ...q, title } : q,
          ),
        },
        `q:${id}:title`,
      );
    },
    editPageDescription() {
      this.$emit(
        "change",
        {
          ...this.modelValue,
          pages: this.modelValue.pages.map((p: { id: string }) =>
            p.id === "p1" ? { ...p, description: "本页说明" } : p,
          ),
        },
        "page:p1:desc",
      );
    },
  },
  template: `<div class="canvas-stub" @click="appendTitle()">
    <button class="edit-q1" @click.stop="editQuestion('q1', 'Q1改')" />
    <button class="edit-q2" @click.stop="editQuestion('q2', 'Q2改')" />
    <button class="edit-desc" @click.stop="editPageDescription()" />
  </div>`,
});
const PreviewStub = defineComponent({
  name: "SurveyPreviewOverlay",
  props: ["definition", "visible"],
  emits: ["update:visible"],
  template: '<div class="preview-stub" />',
});
const AnalysisStub = defineComponent({
  name: "SurveyDataAnalysis",
  props: ["survey", "mode"],
  emits: ["responses-loaded"],
  // 点击上报「当前采集版本的已加载答卷数」，双击上报旧版本计数（不应回写徽标）。
  template:
    '<div class="analysis-stub" @click="$emit(\'responses-loaded\', { revisionId: \'00000000-0000-4000-8000-000000000002\', count: 9 })" @dblclick="$emit(\'responses-loaded\', { revisionId: \'00000000-0000-4000-8000-0000000000ff\', count: 3 })">{{ mode }}</div>',
});
const DistributeStub = defineComponent({
  name: "SurveyDistributePanel",
  props: ["responseLimit"],
  emits: ["update:responseLimit", "change", "close"],
  template:
    '<div class="distribute-stub" @click="$emit(\'update:responseLimit\', 100)" />',
});

function definition(title = "问卷"): SurveyDefinition {
  return {
    version: 1,
    title,
    description: "",
    consent: "",
    questions: [{ id: "q1", type: "text", title: "备注", required: false }],
    pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
  };
}

function detail(extra: {
  currentRevisionId?: string | null;
  contentHash?: string;
  draftTitle?: string;
}): SurveyDetail {
  const publishedDefinition = definition("已发布版");
  const revisionId = extra.currentRevisionId ?? null;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "owner",
    teamId: null,
    title: extra.draftTitle ?? "问卷",
    slug: "aB3-xY9_qW12zK8vN",
    status: revisionId ? "published" : "draft",
    currentRevisionId: revisionId,
    draftVersion: 2,
    completedCount: 5,
    startedCount: 8,
    responseLimit: 5000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    definition: definition(),
    revisions: revisionId
      ? [
          {
            id: revisionId,
            revision: 1,
            createdAt: "2026-01-01T00:00:00Z",
            contentHash:
              extra.contentHash ?? sha256Hex(canonicalSurveyJson(publishedDefinition)),
          },
        ]
      : [],
    canWrite: true,
    canDelete: true,
  };
}

function makeRouter(detailComponent: Component = { template: "<div/>" }) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/u/surveys/:surveyId",
        name: "u.surveys.detail",
        component: detailComponent,
      },
      { path: "/u/surveys", name: "u.surveys.list", component: { template: "<div/>" } },
    ],
  });
}

const shellStubs = (leftActiveTab: string) => ({
  SurveyWorkbenchShell: ShellStub(leftActiveTab),
  SurveyDesignCanvas: CanvasStub,
  SurveyPreviewOverlay: PreviewStub,
  SurveyDataAnalysis: AnalysisStub,
  SurveyDistributePanel: DistributeStub,
});

async function mountWorkspace(
  initialPath = "/u/surveys/s-1",
  leftActiveTab = "outline",
  opts: { copilot?: boolean } = {},
) {
  const router = makeRouter();
  await router.push(initialPath);
  const { host, navigate, copilotRegister } = makeHost(opts);
  const wrapper = mountSurveysComponent(
    SurveyWorkspacePage,
    { global: { plugins: [router], stubs: shellStubs(leftActiveTab) } },
    host,
  );
  await router.isReady();
  await flushPromises();
  return { router, wrapper, navigate, copilotRegister };
}

// 离开保护要走 vue-router 的 in-component 守卫：页面必须是当前路由的组件实例。
const RouterViewHost = defineComponent({ render: () => h(RouterView) });

async function mountWorkspaceViaRouterView(
  initialPath = "/u/surveys/s-1",
  leftActiveTab = "outline",
) {
  const router = makeRouter(SurveyWorkspacePage);
  await router.push(initialPath);
  const { host, navigate } = makeHost();
  const wrapper = mountSurveysComponent(
    RouterViewHost,
    { global: { plugins: [router], stubs: shellStubs(leftActiveTab) } },
    host,
  );
  await router.isReady();
  await flushPromises();
  return { router, wrapper, navigate };
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMocks.require.mockImplementation(
    (options: { accept?: () => void }) => options.accept?.(),
  );
  mocks.get.mockImplementation(async () => detail({ currentRevisionId: null }));
});
afterEach(() => vi.useRealTimers());

function segments(wrapper: ReturnType<typeof mount>) {
  const buttons = wrapper.findAll(".track-segment");
  expect(buttons).toHaveLength(4);
  return buttons;
}

function publishButton(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll("button")
    .find((b) => b.text().includes(t("surveys.publish")))!;
}

/** 设计画布提交一次定义变更（CanvasStub 点击 → 标题追加「!」，进历史栈与自动保存）。 */
async function changeDefinition(wrapper: ReturnType<typeof mount>) {
  await wrapper.find(".canvas-stub").trigger("click");
  await flushPromises();
}

/** 发放段的回收上限内联编辑（DistributeStub 点击 → update:responseLimit 100）。 */
async function changeResponseLimit(wrapper: ReturnType<typeof mount>) {
  await wrapper.find(".distribute-stub").trigger("click");
  await flushPromises();
}

describe("SurveyWorkspacePage 生命周期轨道（issue #217）", () => {
  it("从未发布：发放/数据/分析锁定，设计可用；数据段不渲染", async () => {
    mocks.get.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper } = await mountWorkspace();
    const buttons = segments(wrapper);
    expect(buttons[0]!.attributes("disabled")).toBeUndefined();
    for (const locked of buttons.slice(1)) {
      expect(locked.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.find(".canvas-stub").exists()).toBe(true);
    expect(wrapper.find(".analysis-stub").exists()).toBe(false);
  });

  it("已发布：四段可用，点数据/分析渲染对应模式", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    for (const button of segments(wrapper)) {
      expect(button.attributes("disabled")).toBeUndefined();
    }
    const buttons = segments(wrapper);
    await buttons[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".analysis-stub").text()).toBe("data");
    await buttons[3]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".analysis-stub").text()).toBe("analysis");
  });

  it("?run= 直达分析段（研究数据交付链路回归）", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace("/u/surveys/s-1?run=run-9");
    expect(wrapper.find(".analysis-stub").text()).toBe("analysis");
  });

  it("段切换按钮响应键盘 Enter 与 Space（minor⑥：键盘可激活）", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    await segments(wrapper)[2]!.trigger("keydown.enter");
    await flushPromises();
    expect(wrapper.find(".analysis-stub").exists()).toBe(true);

    await segments(wrapper)[3]!.trigger("keydown.space");
    await flushPromises();
    expect(wrapper.find(".analysis-stub").text()).toBe("analysis");
  });

  it("发布成功后自动落到发放段（先落盘、后确认、再发布）", async () => {
    const revisionDetail = detail({
      currentRevisionId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.get.mockResolvedValue(revisionDetail);
    mocks.save.mockResolvedValue(revisionDetail);
    mocks.publish.mockResolvedValue(revisionDetail);
    const { wrapper } = await mountWorkspace();
    expect(wrapper.find(".canvas-stub").exists()).toBe(true);

    await publishButton(wrapper).trigger("click");
    await flushPromises();
    expect(mocks.publish).toHaveBeenCalledWith(revisionDetail.id);
    expect(wrapper.find(".distribute-stub").exists()).toBe(true);
    expect(wrapper.find(".canvas-stub").exists()).toBe(false);
  });

  it("草稿与采集版本不一致时设计段出 dirty 徽标；自动保存后仍以服务端哈希为准", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    await flushPromises();
    // fixture：草稿 definition("问卷") ≠ 发布版 definition("已发布版") → dirty。
    expect(wrapper.find(".segment-badge--dirty").exists()).toBe(true);

    const saved = detail({
      currentRevisionId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.save.mockResolvedValue(saved);
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalled();
    // 自动保存后 dirty 仍以服务端哈希为准：定义仍 ≠ 发布版 → 徽标还在。
    expect(wrapper.find(".segment-badge--dirty").exists()).toBe(true);
  });

  it("草稿与采集版本一致（刚发布）不出 dirty 徽标", async () => {
    const draft = definition();
    const synced = detail({
      currentRevisionId: "00000000-0000-4000-8000-000000000002",
      contentHash: sha256Hex(canonicalSurveyJson(draft)),
    });
    mocks.get.mockResolvedValue(synced);
    const { wrapper } = await mountWorkspace();
    await flushPromises();
    expect(wrapper.find(".segment-badge--dirty").exists()).toBe(false);
  });
});

describe("SurveyWorkspacePage 自动保存（issue #217）", () => {
  it("顶栏没有「保存修改」按钮（自动保存替代显式保存）", async () => {
    const { wrapper } = await mountWorkspace();
    // 测试豁免裸中文门禁：按钮文案随键位删除已不存在，用字面量断言其缺席。
    expect(
      wrapper.findAll("button").some((b) => b.text().includes("保存修改")),
    ).toBe(false);
  });

  it("变更后防抖保存，状态变「已保存」", async () => {
    const savedDetail = detail({ currentRevisionId: null });
    mocks.save.mockResolvedValue(savedDetail);
    const { wrapper } = await mountWorkspace();
    vi.useFakeTimers();

    await changeDefinition(wrapper);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(wrapper.find(".save-state__text").text()).toBe(t("surveys.saving"));

    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [id, version, sentDefinition, limit] = mocks.save.mock.calls[0]!;
    expect(id).toBe(savedDetail.id);
    expect(version).toBe(2);
    expect(sentDefinition).toEqual({ ...definition(), title: "问卷!" });
    expect(limit).toBe(5000);
    expect(wrapper.find(".save-state__text").text()).toContain(
      t("surveys.savedAt", { time: "" }).slice(0, 4),
    );
  });

  it("发放段内联修改回收上限：与 definition 同一 PATCH 共用乐观锁", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    mocks.save.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    await segments(wrapper)[1]!.trigger("click");
    await flushPromises();
    vi.useFakeTimers();

    await changeResponseLimit(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [, , sentDefinition, limit] = mocks.save.mock.calls[0]!;
    expect(limit).toBe(100);
    expect(sentDefinition).toEqual(definition());
  });

  it("409 冲突是终态：横幅 + 重新加载，不再自动保存", async () => {
    mocks.save.mockRejectedValue(
      new SurveysApiError(409, "version_conflict", null),
    );
    const { wrapper } = await mountWorkspace();
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    expect(wrapper.text()).toContain(t("surveys.conflictBanner"));

    // 再改也不发：冲突必须由用户重新加载解决。
    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.save).toHaveBeenCalledTimes(1);

    // 重新加载恢复：横幅消失。
    mocks.get.mockClear();
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes(t("surveys.reload")))!
      .trigger("click");
    await flushPromises();
    expect(mocks.get).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain(t("surveys.conflictBanner"));
  });

  it("保存失败出「保存失败 · 重试」，点重试重发", async () => {
    mocks.save.mockRejectedValueOnce(
      new SurveysApiError(500, "server", null),
    );
    mocks.save.mockResolvedValueOnce(detail({ currentRevisionId: null }));
    const { wrapper } = await mountWorkspace();
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    const retry = wrapper
      .findAll("button")
      .find((b) => b.text().includes(t("surveys.saveRetry")))!;
    expect(retry.exists()).toBe(true);

    await retry.trigger("click");
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".save-state__text").text()).toContain(
      t("surveys.savedAt", { time: "" }).slice(0, 4),
    );
  });

  it("撤销/重做：提交后可撤销，撤销触发再次保存", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper } = await mountWorkspace();
    vi.useFakeTimers();
    const undoButton = wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === t("surveys.undo"))!;
    const redoButton = wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === t("surveys.redo"))!;
    expect(undoButton.attributes("disabled")).toBeDefined();

    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);

    expect(undoButton.attributes("disabled")).toBeUndefined();
    await undoButton.trigger("click");
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1]![2]).toEqual(definition());

    expect(redoButton.attributes("disabled")).toBeUndefined();
    await redoButton.trigger("click");
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save.mock.calls[2]![2]).toEqual({ ...definition(), title: "问卷!" });
  });
});

describe("SurveyWorkspacePage 发布确认与离开保护（issue #217）", () => {
  it("发布先弹确认（带下一版号），确认后才发布；无未落盘内容不发保存", async () => {
    const revisionDetail = detail({
      currentRevisionId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.get.mockResolvedValue(revisionDetail);
    mocks.publish.mockResolvedValue(revisionDetail);
    const { wrapper } = await mountWorkspace();

    confirmMocks.require.mockImplementation(() => {});
    await publishButton(wrapper).trigger("click");
    await flushPromises();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();

    const options = confirmMocks.require.mock.calls.at(-1)![0] as {
      message: string;
      accept: () => void;
    };
    expect(options.message).toBe(t("surveys.publishConfirm", { n: 2 }));

    confirmMocks.require.mockImplementation(
      (o: { accept?: () => void }) => o.accept?.(),
    );
    await publishButton(wrapper).trigger("click");
    await flushPromises();
    expect(mocks.publish).toHaveBeenCalledWith(revisionDetail.id);
    expect(wrapper.find(".distribute-stub").exists()).toBe(true);
  });

  it("发布前有未落盘修改：flush 保存先落地，再弹确认", async () => {
    const revisionDetail = detail({
      currentRevisionId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.get.mockResolvedValue(revisionDetail);
    mocks.save.mockResolvedValue(revisionDetail);
    mocks.publish.mockResolvedValue(revisionDetail);
    const { wrapper } = await mountWorkspace();
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    expect(mocks.save).not.toHaveBeenCalled();

    confirmMocks.require.mockImplementation(() => {});
    await publishButton(wrapper).trigger("click");
    await vi.advanceTimersByTimeAsync(100);
    // flush 立即保存（不等 1.5s 防抖），确认未给前不发布。
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("客户端校验不过时发布按钮禁用", async () => {
    const broken = detail({ currentRevisionId: null });
    broken.definition = definition();
    broken.definition.pages.push({ id: "p2", title: "空页", questionIds: [] });
    mocks.get.mockResolvedValue(broken);
    const { wrapper } = await mountWorkspace();
    await flushPromises();
    expect(publishButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("有未落盘修改时离开：先自动落盘，成功则不打扰", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { router, wrapper } = await mountWorkspaceViaRouterView();
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    confirmMocks.require.mockImplementation(() => {});
    await router.push("/u/surveys");
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("u.surveys.list");
    expect(confirmMocks.require).not.toHaveBeenCalled();
  });

  it("保存失败时离开被拦下；确认后放行", async () => {
    mocks.save.mockRejectedValue(
      new SurveysApiError(500, "server", null),
    );
    const { router, wrapper } = await mountWorkspaceViaRouterView();
    vi.useFakeTimers();
    await changeDefinition(wrapper);
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);

    confirmMocks.require.mockImplementation(() => {});
    await router.push("/u/surveys");
    await vi.advanceTimersByTimeAsync(200);
    expect(router.currentRoute.value.name).toBe("u.surveys.detail");
    const options = confirmMocks.require.mock.calls.at(-1)![0] as {
      header: string;
      accept: () => void;
    };
    expect(options.header).toBe(t("surveys.leaveHeader"));

    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    options.accept();
    await vi.advanceTimersByTimeAsync(100);
    expect(router.currentRoute.value.name).toBe("u.surveys.list");
  });

  it("没有未保存修改时离开不打扰", async () => {
    const { router } = await mountWorkspaceViaRouterView();
    vi.useFakeTimers();
    await router.push("/u/surveys");
    await vi.advanceTimersByTimeAsync(100);
    expect(router.currentRoute.value.name).toBe("u.surveys.list");
    expect(confirmMocks.require).not.toHaveBeenCalled();
  });
});

describe("SurveyWorkspacePage 撤销与自动保存时序（审判必修③）", () => {
  function twoQuestionDefinition(): SurveyDefinition {
    return {
      version: 1,
      title: "问卷",
      description: "",
      consent: "",
      questions: [
        { id: "q1", type: "text", title: "Q1", required: false },
        { id: "q2", type: "text", title: "Q2", required: false },
      ],
      pages: [{ id: "p1", title: "第一页", questionIds: ["q1", "q2"] }],
    };
  }

  async function mountWithTwoQuestions() {
    const base = detail({ currentRevisionId: null });
    mocks.get.mockResolvedValue({ ...base, definition: twoQuestionDefinition() });
    return mountWorkspace();
  }

  function undoButton(wrapper: ReturnType<typeof mount>) {
    return wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === t("surveys.undo"))!;
  }

  it("防抖未到时撤销：计时器以撤销后的快照重排，只发一发且内容=画布", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper } = await mountWithTwoQuestions();
    vi.useFakeTimers();

    await wrapper.find(".edit-q1").trigger("click");
    await wrapper.find(".edit-q2").trigger("click");
    // 防抖未到就撤销：一步只回退最后一次编辑（Q2），不发被撤销前的旧态。
    await undoButton(wrapper).trigger("click");
    await vi.advanceTimersByTimeAsync(1600);

    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [, version, sent] = mocks.save.mock.calls[0]!;
    expect(version).toBe(2);
    expect(sent).toEqual({
      ...twoQuestionDefinition(),
      questions: [
        { id: "q1", type: "text", title: "Q1改", required: false },
        { id: "q2", type: "text", title: "Q2", required: false },
      ],
    });
  });

  it("跨题编辑撤销一次只回退最后一题（label 含目标 id，不合并）", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper } = await mountWithTwoQuestions();
    vi.useFakeTimers();

    await wrapper.find(".edit-q1").trigger("click");
    // 间隔 <800ms 的连续编辑，label 互异，绝不合并成一条。
    await wrapper.find(".edit-q2").trigger("click");
    await wrapper.find(".edit-desc").trigger("click");
    await undoButton(wrapper).trigger("click");
    await vi.advanceTimersByTimeAsync(1600);

    const [, , sent] = mocks.save.mock.calls.at(-1)!;
    expect(sent.questions[0]!.title).toBe("Q1改");
    expect(sent.questions[1]!.title).toBe("Q2改");
    // 页说明编辑被撤销：回到编辑前的「无页说明」态。
    expect(sent.pages[0]!.description ?? "").toBe("");
  });

  it("在途保存期间撤销：先落盘旧态再撤销，重发的 PATCH 版本单调、内容=画布", async () => {
    const gates: Array<() => void> = [];
    mocks.save.mockImplementation(
      (_id: string, expectedVersion: number) =>
        new Promise<SurveyDetail>((resolve) =>
          gates.push(() =>
            resolve({
              ...detail({ currentRevisionId: null }),
              draftVersion: expectedVersion + 1,
            }),
          ),
        ),
    );
    const { wrapper } = await mountWithTwoQuestions();
    vi.useFakeTimers();

    await wrapper.find(".edit-q1").trigger("click");
    await wrapper.find(".edit-q2").trigger("click");
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.save).toHaveBeenCalledTimes(1);

    // 保存 #1 在途时撤销：undo 内部先等它落地再改历史。
    await undoButton(wrapper).trigger("click");
    await vi.advanceTimersByTimeAsync(100);
    gates.shift()!();
    // 保存落地 → flush 返回 → 撤销改历史 → 重排计时器：逐拍微任务。
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(2);

    const [, version2, sent2] = mocks.save.mock.calls[1]!;
    expect(version2).toBe(3);
    // 撤销一次只回退最后一题；Q1 的编辑保留。
    expect(sent2.questions[0]!.title).toBe("Q1改");
    expect(sent2.questions[1]!.title).toBe("Q2");
  });

  it("pagehide 用宿主 beacon 同步落盘未保存内容（刷新窗口不静默丢）", async () => {
    const beacons: Array<{ path: string; body: PatchBody }> = [];
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    // 该用例需要带 beacon 的 host：单独装配。
    const beaconHost = makeHost({
      beacon: (path, body) => beacons.push({ path, body: body as PatchBody }),
    });
    const router = makeRouter();
    await router.push("/u/surveys/s-1");
    const wrapper = mountSurveysComponent(
      SurveyWorkspacePage,
      { global: { plugins: [router], stubs: shellStubs("outline") } },
      beaconHost.host,
    );
    await router.isReady();
    await flushPromises();
    vi.useFakeTimers();
    await wrapper.find(".edit-q1").trigger("click");
    expect(mocks.save).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    expect(beacons).toHaveLength(1);
    const { path, body } = beacons[0]!;
    expect(path).toContain("/api/surveys/");
    expect(body.expectedVersion).toBe(2);
    expect((body.definition as SurveyDefinition).questions[0]!.title).toBe("Q1改");
    expect(body.responseLimit).toBe(5000);
  });
});

describe("SurveyWorkspacePage 数据口径同步（issue #217）", () => {
  it("数据徽标跟随数据段当前加载版本的口径；已回收数只认当前采集版本（M2）", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    const badge = () => wrapper.find(".segment-badge--count");
    expect(badge().text()).toBe("5");

    await segments(wrapper)[2]!.trigger("click");
    await flushPromises();
    const analysis = wrapper.findComponent({ name: "SurveyDataAnalysis" });
    // 切回 v1（旧版本，已加载 3 份）：徽标跟数据段口径变 3；但 completedCount
    // （发放段回收进度的口径）不被旧版本计数覆盖。
    await wrapper.find(".analysis-stub").trigger("dblclick");
    await flushPromises();
    expect(badge().text()).toBe("3");
    expect(analysis.props("survey").completedCount).toBe(5);

    // 加载回当前采集版本：徽标与 completedCount 一并同步到已加载口径。
    await wrapper.find(".analysis-stub").trigger("click");
    await flushPromises();
    expect(badge().text()).toBe("9");
    expect(analysis.props("survey").completedCount).toBe(9);
  });

  it("离开数据/分析段后徽标不再跟随旧版本口径，回到已回收数", async () => {
    mocks.get.mockResolvedValue(
      detail({ currentRevisionId: "00000000-0000-4000-8000-000000000002" }),
    );
    const { wrapper } = await mountWorkspace();
    await segments(wrapper)[2]!.trigger("click");
    await flushPromises();
    // 加载旧版本：徽标跟数据段口径变 3。
    await wrapper.find(".analysis-stub").trigger("dblclick");
    await flushPromises();
    expect(wrapper.find(".segment-badge--count").text()).toBe("3");

    // 回设计段：数据段版本选择随之作废，徽标回到采集口径（completedCount 5）。
    await segments(wrapper)[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".segment-badge--count").text()).toBe("5");
  });
});

// ── AI 建卷落地提示（issue #217）────────────────────────────────────────────
// 生成会话是 global scope，落地工作区右岛的是新的空 survey 会话：survey_create
// 帧载荷经一次性单槽带进来，load 成功后取走展示一张提示卡（取走即清 → 刷新
// 不重复）。fixture 工作区路由参数是 s-1。

describe("SurveyWorkspacePage AI 交付新鲜度（#223）", () => {
  const editDelivery = (baseDraftVersion: number) => ({
    type: "survey_edit" as const,
    surveyId: "s-1",
    operationId: "op-fresh-1",
    baseDraftVersion,
    summary: "AI 改题",
    appliedOps: [{ op: "set_meta", title: "AI 标题" }],
  });

  async function deliveryHandlers(copilotRegister: ReturnType<typeof vi.fn>) {
    expect(copilotRegister).toHaveBeenCalledTimes(1);
    return copilotRegister.mock.calls[0]![0] as {
      onSurveyDeliveryFrame: (delivery: unknown) => void | Promise<void>;
    };
  }

  it("基线一致且无未保存编辑：自动重放进撤销栈并自动保存", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper, copilotRegister } = await mountWorkspace(
      "/u/surveys/s-1",
      "outline",
      { copilot: true },
    );
    vi.useFakeTimers();
    const handlers = await deliveryHandlers(copilotRegister!);

    await handlers.onSurveyDeliveryFrame(editDelivery(2));
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.copilot.applied", { n: 1 }));
    expect(wrapper.text()).not.toContain(t("surveys.copilot.staleDelivery"));

    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [, , sentDefinition] = mocks.save.mock.calls[0]!;
    expect(sentDefinition).toEqual({ ...definition(), title: "AI 标题" });
  });

  it("基线落后于本地（推理期间有人保存过）：不自动应用，转横幅待确认", async () => {
    const { wrapper, copilotRegister } = await mountWorkspace(
      "/u/surveys/s-1",
      "outline",
      { copilot: true },
    );
    vi.useFakeTimers();
    const handlers = await deliveryHandlers(copilotRegister!);

    await handlers.onSurveyDeliveryFrame(editDelivery(1));
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.copilot.staleDelivery"));
    expect(wrapper.text()).not.toContain(t("surveys.copilot.applied", { n: 1 }));

    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("本地有未落盘编辑（防抖在途）：同样不自动应用", async () => {
    const { wrapper, copilotRegister } = await mountWorkspace(
      "/u/surveys/s-1",
      "outline",
      { copilot: true },
    );
    vi.useFakeTimers();
    const handlers = await deliveryHandlers(copilotRegister!);

    await changeDefinition(wrapper);
    await handlers.onSurveyDeliveryFrame(editDelivery(2));
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.copilot.staleDelivery"));
  });

  it("横幅确认「仍要应用」后重放；「丢弃」则清空不落库", async () => {
    mocks.save.mockResolvedValue(detail({ currentRevisionId: null }));
    const { wrapper, copilotRegister } = await mountWorkspace(
      "/u/surveys/s-1",
      "outline",
      { copilot: true },
    );
    vi.useFakeTimers();
    const handlers = await deliveryHandlers(copilotRegister!);

    await handlers.onSurveyDeliveryFrame(editDelivery(1));
    await flushPromises();
    const applyAnyway = wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.copilot.staleApply"))!;
    await applyAnyway.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(t("surveys.copilot.applied", { n: 1 }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]![2]).toEqual({
      ...definition(),
      title: "AI 标题",
    });

    // 丢弃路径：新一条过期交付出现后点「丢弃」，不产生保存。
    mocks.save.mockClear();
    await handlers.onSurveyDeliveryFrame({ ...editDelivery(99), operationId: "op-fresh-2" });
    await flushPromises();
    const discard = wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.copilot.staleDiscard"))!;
    await discard.trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("SurveyWorkspacePage AI 建卷落地提示（issue #217）", () => {
  const CREATED_ID = "00000000-0000-4000-8000-0000000000c1";
  const frame = (surveyId: string, title: string): AiCreatedSurveyHandoff => ({
    type: "survey_create",
    surveyId,
    operationId: "op-created-card",
    title,
    issues: [{ path: "pages[1]", code: "empty_page", message: "第 2 页没有题目" }],
  });

  const bannerText = (title: string) =>
    t("surveys.copilot.aiCreated", { title, pages: 1, questions: 1 });

  beforeEach(() => __resetAiCreatedSurveyHandoffForTest());
  afterEach(() => __resetAiCreatedSurveyHandoffForTest());

  it("带交接落地：提示卡出现（标题 + 页/题数 + issue 提示），关闭即消失", async () => {
    setAiCreatedSurveyHandoff(frame("s-1", "科研工具使用习惯调查"));
    const { wrapper } = await mountWorkspace();
    expect(wrapper.text()).toContain(bannerText("科研工具使用习惯调查"));
    expect(wrapper.text()).toContain(t("surveys.copilot.aiCreatedIssues", { n: 1 }));

    await wrapper.find(".p-message-close-button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain(bannerText("科研工具使用习惯调查"));
    wrapper.unmount();
  });

  it("提示只出现一次：卸载重挂（刷新同口径）不再重复", async () => {
    setAiCreatedSurveyHandoff(frame("s-1", "科研工具使用习惯调查"));
    const first = await mountWorkspace();
    expect(first.wrapper.text()).toContain(bannerText("科研工具使用习惯调查"));
    first.wrapper.unmount();

    const second = await mountWorkspace();
    expect(second.wrapper.text()).not.toContain(bannerText("科研工具使用习惯调查"));
    second.wrapper.unmount();
  });

  it("surveyId 不匹配不出提示（别的问卷的交接不串场）", async () => {
    setAiCreatedSurveyHandoff(frame("other-survey", "别的问卷"));
    const { wrapper } = await mountWorkspace();
    expect(wrapper.text()).not.toContain(bannerText("别的问卷"));
    // 槽未被误清：之后再进匹配的问卷仍能取到。
    expect(takeAiCreatedSurveyHandoff("other-survey")?.title).toBe("别的问卷");
    wrapper.unmount();
  });

  it("删除问卷：点版本面板删除 → 单层确认 → 调 remove 并回列表（P2 发现的双层确认死路）", async () => {
    mocks.remove.mockImplementation(async () => ({ ok: true }));
    const { navigate, wrapper } = await mountWorkspace(
      "/u/surveys/s-1",
      "versions",
    );
    const confirmCalls: Array<{ header?: string; accept?: () => void }> = [];
    confirmMocks.require.mockImplementation(
      (options: { header?: string; accept?: () => void }) => {
        confirmCalls.push(options);
        options.accept?.();
      },
    );

    await wrapper.findComponent(SurveyVersionsPanel).find(".versions-delete").trigger("click");
    await flushPromises();

    // 只有父层一道确认：面板层已拆，双层链里第二层同步 require 会被吞掉。
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]?.header).toBe(t("surveys.deleteSurvey"));
    expect(mocks.remove).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.list" });
    wrapper.unmount();
  });

  // 活流收到 survey_create 帧的端到端接线（导航 + 落地提示）见
  // SurveyWorkspacePage.aiCreate.component.test.ts：桥是宿主单例，本文件的
  // 历史用例不卸载实例，emit 会广播到残留 handler、单槽被陈旧实例先取走，
  // 断言不稳定——该路径需要在无残留的模块注册表里跑。
});

describe("问卷诊断修订的工作台闭环", () => {
  const review = (version = 2) => ({
    type: "survey_review" as const, surveyId: "s-1", operationId: "review-integration-1",
    baseDraftVersion: version, summary: "澄清时间范围",
    findings: [{ id: "f1", checkId: "wording.timeframe", questionId: "q1", title: "明确时间",
      severity: "major" as const, reason: "行为题需要时间范围", recommendation: "明确过去一学期",
      suggestedOps: [{ op: "update_question" as const, questionId: "q1", patch: { title: "过去一学期的备注" } }],
    }],
  });

  it("应用建议进入同一自动保存与撤销链，应用后诊断立即过期", async () => {
    const { wrapper, copilotRegister } = await mountWorkspace("/u/surveys/s-1", "outline", { copilot: true });
    const handlers = copilotRegister!.mock.calls[0]![0];
    handlers.onSurveyDeliveryFrame(review());
    await flushPromises();
    vi.useFakeTimers();
    const panel = wrapper.findComponent(SurveyResearchAssistant);
    expect(panel.props("stale")).toBe(false);
    panel.vm.$emit("apply", "f1");
    await flushPromises();
    expect(panel.props("stale")).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.save.mock.calls.at(-1)![2].questions[0].title).toBe("过去一学期的备注");
    await wrapper.find(`button[aria-label="${t("surveys.undo")}"]`).trigger("click");
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    expect(mocks.save.mock.calls.at(-1)![2].questions[0].title).toBe("备注");
    wrapper.unmount();
  });

  it("旧版本诊断即便强行发出应用事件也不能修改草稿", async () => {
    const { wrapper, copilotRegister } = await mountWorkspace("/u/surveys/s-1", "outline", { copilot: true });
    copilotRegister!.mock.calls[0]![0].onSurveyDeliveryFrame(review(1));
    await flushPromises();
    const panel = wrapper.findComponent(SurveyResearchAssistant);
    expect(panel.props("stale")).toBe(true);
    panel.vm.$emit("apply", "f1");
    await flushPromises();
    expect(mocks.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
