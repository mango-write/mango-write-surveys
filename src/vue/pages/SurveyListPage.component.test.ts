// 列表页组件测试（issue #217）：搜索、状态筛选、点击进工作区、新建跳转。
// 宿主能力全部经 createTestHost 注入：transport 按 path/method 分发到 api mocks，
// navigate/copilot 用 spy——导航断言面向宿主契约而非具体路由表。
// Dialog 以内联 stub 渲染 footer 槽，避免 PrimeVue 弹层 teleport 到 body 后无法断言。
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

import type { SurveySummary, ToolSurveyDelivery } from "../../contracts/index.js";
import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveysCopilotHandlers, SurveysWebHost } from "../host.js";
import {
  __resetAiCreatedSurveyHandoffForTest,
  takeAiCreatedSurveyHandoff,
} from "../lib/ai-created-handoff.js";

import SurveyListPage from "./SurveyListPage.vue";

const i18n = createSurveysTestI18n();

const t = (key: string) => i18n.global.t(key);

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
}));

interface Body {
  title?: string;
  expectedVersion?: number;
  definition?: unknown;
  responseLimit?: number;
}

function makeHost(): { host: SurveysWebHost; navigate: ReturnType<typeof vi.fn>; copilot: SurveysCopilotHandlers[]; presentation: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; fillComposer: ReturnType<typeof vi.fn> } {
  const navigate = vi.fn();
  const copilot: SurveysCopilotHandlers[] = [];
  const presentation = vi.fn();
  const release = vi.fn();
  const fillComposer = vi.fn();
  const host = createTestHost({
    transport: {
      request: (async (path: string, init?: { method?: string; body?: unknown }) => {
        const method = init?.method ?? "GET";
        const body = (init?.body ?? {}) as Body;
        if (method === "GET" && path === "/api/surveys") return mocks.list();
        if (method === "POST" && path === "/api/surveys") return mocks.create(body.title ?? "");
        if (method === "PATCH") {
          const id = path.split("/").at(-1)!;
          return mocks.save(id, body.expectedVersion, body.definition, body.responseLimit);
        }
        throw new Error(`用例未覆盖的 transport 请求：${method} ${path}`);
      }) as never,
    },
    navigate: navigate as never,
    copilot: {
      registerHandlers: (handlers) => {
        copilot.push(handlers);
        return () => {};
      },
      setContextRefs: () => {},
      fillComposer,
      focusComposer: () => {},
      releasePageState: release,
      setSurfacePresentation: presentation,
    },
  });
  return { host, navigate, copilot, presentation, release, fillComposer };
}

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

function summary(extra: Partial<SurveySummary>): SurveySummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    userId: "owner",
    teamId: null,
    title: "Untitled",
    slug: "aB3-xY9_qW12zK8vN",
    status: "draft",
    currentRevisionId: null,
    draftVersion: 1,
    completedCount: 0,
    responseLimit: 5000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  } as SurveySummary;
}

const ITEMS: SurveySummary[] = [
  summary({ id: "00000000-0000-4000-8000-000000000001", title: "Alpha 阅读习惯调查", status: "draft" }),
  summary({
    id: "00000000-0000-4000-8000-000000000002",
    title: "Beta 实验问卷",
    status: "closed",
    completedCount: 7,
  }),
  summary({
    id: "00000000-0000-4000-8000-000000000003",
    title: "Gamma 访谈前期",
    status: "published",
    completedCount: 3,
  }),
];

async function mountList() {
  const { host, navigate, copilot, presentation, release, fillComposer } = makeHost();
  const wrapper = mountSurveysComponent(
    SurveyListPage,
    { global: { stubs: { Dialog: DialogStub } } },
    host,
  );
  await flushPromises();
  return { host, navigate, copilot, presentation, release, fillComposer, wrapper };
}

function rows(wrapper: ReturnType<typeof mountSurveysComponent>) {
  return wrapper.findAll(".survey-row");
}

describe("SurveyListPage（issue #217）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ items: ITEMS });
    mocks.create.mockResolvedValue({
      ...summary({ id: "00000000-0000-4000-8000-000000000009", title: "新建问卷" }),
    });
    mocks.save.mockImplementation(async (_id: string, _version: number, definition: { title: string }) => ({
      ...summary({ id: "00000000-0000-4000-8000-000000000009", title: definition.title }),
    }));
  });

  it("渲染标题、状态与完成数，点击行进入工作区", async () => {
    const { navigate, wrapper } = await mountList();
    expect(rows(wrapper)).toHaveLength(3);
    expect(wrapper.text()).toContain("Alpha 阅读习惯调查");
    expect(wrapper.text()).toContain(t("surveys.status.closed"));

    await rows(wrapper)[1]!.trigger("click");
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith({
      name: "surveys.detail",
      surveyId: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("标题搜索只过滤显示，不改数据源", async () => {
    const { wrapper } = await mountList();
    await wrapper
      .find(`input[aria-label="${t("surveys.searchPlaceholder")}"]`)
      .setValue("beta");
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0]!.text()).toContain("Beta 实验问卷");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("状态筛选：切到已关闭只剩 closed 行，全部恢复", async () => {
    const { wrapper } = await mountList();
    const buttons = wrapper.findAll(".filter-option");
    await buttons.find((b) => b.text() === t("surveys.status.closed"))!.trigger("click");
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0]!.text()).toContain("Beta 实验问卷");

    await buttons.find((b) => b.text() === t("surveys.filterAll"))!.trigger("click");
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(3);
  });

  it("搜索与筛选叠加生效；无命中给空结果文案", async () => {
    const { wrapper } = await mountList();
    await wrapper
      .find(`input[aria-label="${t("surveys.searchPlaceholder")}"]`)
      .setValue("Gamma");
    const buttons = wrapper.findAll(".filter-option");
    await buttons.find((b) => b.text() === t("surveys.status.closed"))!.trigger("click");
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain(t("surveys.noMatch"));
  });

  it("空列表首访：AI 建卷起点以 hero 密度突出，空白新建仍跳工作区", async () => {
    mocks.list.mockResolvedValue({ items: [] });
    const { navigate, wrapper } = await mountList();
    expect(wrapper.text()).toContain(t("surveys.empty"));
    const hero = wrapper.find(".create-start");
    expect(hero.classes()).toContain("is-hero");
    expect(hero.text()).toContain(t("surveys.createStart.question"));
    expect(hero.find("textarea").exists()).toBe(true);

    // 空白新建是次要动作：hero 发事件，列表页打开既有新建弹层。
    const blankButton = hero
      .findAll("button")
      .find((b) => b.text() === t("surveys.create"))!;
    await blankButton.trigger("click");
    await flushPromises();
    const dialog = wrapper.find(".dialog-stub");
    expect(dialog.exists()).toBe(true);
    await dialog.find("input").setValue("新建问卷");
    await dialog
      .findAll("button")
      .find((b) => b.text() === t("surveys.create"))!
      .trigger("click");
    await flushPromises();
    expect(mocks.create).toHaveBeenCalledWith("新建问卷");
    expect(navigate).toHaveBeenCalledWith({
      name: "surveys.detail",
      surveyId: "00000000-0000-4000-8000-000000000009",
    });
  });

  it("返回态：建卷入口收敛为紧凑卡（AI 主 + 模板/空白次），页头不再平铺三按钮", async () => {
    const { wrapper } = await mountList();
    const header = wrapper.find(".survey-page-header");
    expect(header.text()).not.toContain(t("surveys.copilot.generate"));
    expect(header.text()).not.toContain(t("surveys.templates.pick"));
    const card = wrapper.find(".create-start");
    expect(card.exists()).toBe(true);
    expect(card.classes()).toContain("is-compact");
    const labels = card.findAll("button").map((b) => b.text());
    expect(labels).toContain(t("surveys.createStart.submit"));
    expect(labels).toContain(t("surveys.templates.pick"));
    expect(labels).toContain(t("surveys.create"));
    wrapper.unmount();
  });

  it("列表 scope 注册 Copilot 呈现，卸载清除；生成动作走 prompt 语义（M2）", async () => {
    const { presentation, release, wrapper } = await mountList();
    expect(presentation).toHaveBeenCalled();
    const value = presentation.mock.calls.at(-1)![0] as {
      title: string;
      composerPlaceholder: string;
      actions: Array<{ id: string; label: string; primary?: boolean; prompt?: string; run?: () => void }>;
    };
    expect(value.title).toBe(t("surveys.copilot.listTitle"));
    expect(value.composerPlaceholder).toBe(t("surveys.copilot.listPlaceholder"));
    expect(value.actions).toHaveLength(1);
    expect(value.actions[0]!.label).toBe(t("surveys.copilot.generate"));
    expect(value.actions[0]!.prompt).toBe(t("surveys.copilot.generateTemplate"));
    expect(value.actions[0]!.run).toBeUndefined();
    wrapper.unmount();
    // 卸载清理归 releasePageState（契约上负责页面写入桥的状态，含 surface）。
    expect(release).toHaveBeenCalled();
    expect(presentation).toHaveBeenCalledTimes(1);
  });

  it("返回态紧凑卡输入研究想法点生成：走 fillComposer+focus（宿主无 sendPrompt 时）", async () => {
    const { fillComposer, wrapper } = await mountList();
    const card = wrapper.find(".create-start");
    await card.find("textarea").setValue("科研工具使用调查");
    await card
      .findAll("button")
      .find((b) => b.text() === t("surveys.createStart.submit"))!
      .trigger("click");
    await flushPromises();
    expect(fillComposer).toHaveBeenCalledTimes(1);
    expect(fillComposer.mock.calls[0]![0] as string).toContain("科研工具使用调查");
    // survey_create 帧的交接与导航归页面 handler（见下方交付帧用例）。
    wrapper.unmount();
  });

  it("从模板开始：选模板建卷并立即落模板定义为草稿，然后进工作区", async () => {    const { navigate, wrapper } = await mountList();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === t("surveys.templates.pick"))!
      .trigger("click");
    await flushPromises();
    // 列表页的 Dialog 全部走同一 stub：此时打开的是模板弹层。
    const picker = wrapper.find(".dialog-stub");
    expect(picker.exists()).toBe(true);
    expect(picker.text()).toContain(t("surveys.templates.sus.name"));

    const cards = picker.findAll(".template-card");
    await cards[1]!.trigger("click");
    await flushPromises();
    await picker
      .findAll("button")
      .find((b) => b.text() === t("surveys.templates.use"))!
      .trigger("click");
    await flushPromises();

    expect(mocks.create).toHaveBeenCalledWith(t("surveys.templates.sus.name"));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [id, expectedVersion, definition] = mocks.save.mock.calls[0]!;
    expect(id).toBe("00000000-0000-4000-8000-000000000009");
    expect(expectedVersion).toBe(1);
    expect(definition).toMatchObject({
      version: 1,
      title: t("surveys.templates.sus.name"),
    });
    expect(navigate).toHaveBeenCalledWith({
      name: "surveys.detail",
      surveyId: "00000000-0000-4000-8000-000000000009",
    });
    wrapper.unmount();
  });
});

// ── AI 生成交付帧（issue #217）──────────────────────────────────────────────
// 生成会话留在列表页（global scope）：收到 survey_create 帧只做「toast + 载荷
// 交接 + 导航」，AI 的「我建了什么」由工作区落地提示卡接手，不留在本页。
describe("SurveyListPage AI 生成交付帧（issue #217）", () => {
  const CREATED_ID = "00000000-0000-4000-8000-0000000000c2";

  beforeEach(() => __resetAiCreatedSurveyHandoffForTest());
  afterEach(() => __resetAiCreatedSurveyHandoffForTest());

  function emitSurveyFrame(
    copilot: SurveysCopilotHandlers[],
    frame: ToolSurveyDelivery,
  ) {
    for (const handlers of copilot) handlers.onSurveyDeliveryFrame?.(frame);
  }

  it("survey_create 交付帧：载荷交接给工作区并导航到新问卷", async () => {
    const { navigate, copilot, wrapper } = await mountList();
    emitSurveyFrame(copilot, {
      type: "survey_create",
      surveyId: CREATED_ID,
      operationId: "op-list-create",
      title: "AI 生成的问卷",
    });
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.detail", surveyId: CREATED_ID });
    // 帧载荷已进入交接单槽（工作区落地提示卡的数据源，取走即清）。
    expect(takeAiCreatedSurveyHandoff(CREATED_ID)?.title).toBe("AI 生成的问卷");
    wrapper.unmount();
  });

  it("survey_edit 交付帧不归列表页处理（导航与重放都是工作区职责）", async () => {
    const { navigate, copilot, wrapper } = await mountList();
    emitSurveyFrame(copilot, {
      type: "survey_edit",
      surveyId: "00000000-0000-4000-8000-000000000001",
      operationId: "op-list-edit",
      baseDraftVersion: 2,
      summary: "把第 1 题改成多选",
      appliedOps: [],
    });
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
