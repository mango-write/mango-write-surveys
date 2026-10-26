// 问卷切换器测试（M2 补）：按需加载（不挂载即拉、重开不重拉）、当前卷置顶
// 标记、标题过滤、选择导航、查看全部、错误重试。Popover 用内联 stub 避免弹层
// teleport 到 body 后无法断言。
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveySummary } from "../../contracts/index.js";
import SurveySwitcher from "./SurveySwitcher.vue";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

const PopoverStub = defineComponent({
  name: "Popover",
  emits: ["show", "hide"],
  setup(_, { expose, emit, slots }) {
    const visible = ref(false);
    const setHidden = () => {
      if (!visible.value) return;
      visible.value = false;
      emit("hide");
    };
    expose({
      toggle: () => {
        visible.value = !visible.value;
        emit(visible.value ? "show" : "hide");
      },
      hide: setHidden,
    });
    return () => (visible.value ? h("div", { class: "popover-stub" }, slots.default?.()) : null);
  },
});

function summary(overrides: Partial<SurveySummary>): SurveySummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "owner",
    teamId: null,
    title: "问卷甲",
    slug: "aB3-xY9_qW12zK8vN",
    status: "draft",
    currentRevisionId: null,
    draftVersion: 1,
    completedCount: 0,
    responseLimit: 5000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeList(items: SurveySummary[] | Error) {
  return vi.fn(async () => {
    if (items instanceof Error) throw items;
    return { items };
  });
}

async function mountSwitcher(list: ReturnType<typeof makeList>, props = { currentId: "s-1", currentTitle: "当前卷新标题" }) {
  const navigate = vi.fn();
  const wrapper = mountSurveysComponent(
    SurveySwitcher,
    { props, global: { stubs: { Popover: PopoverStub } } },
    createTestHost({
      transport: { request: list as never },
      navigate: navigate as never,
    }),
  );
  await flushPromises();
  return { navigate, wrapper };
}

function triggers(wrapper: ReturnType<typeof mountSurveysComponent>) {
  const buttons = wrapper.findAll("button");
  return {
    back: buttons.find((b) => b.text() === "返回问卷列表")!,
    open: buttons.find((b) => b.attributes("aria-label") === "切换问卷")!,
  };
}

describe("问卷切换器（工作台标题区）", () => {
  it("按需加载：挂载不拉列表，打开才 api.list，重开不重拉", async () => {
    const list = makeList([summary({ id: "s-2", title: "问卷乙", status: "published", completedCount: 4 })]);
    const { wrapper } = await mountSwitcher(list);
    expect(list).not.toHaveBeenCalled();
    const { open } = triggers(wrapper);
    await open.trigger("click");
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".popover-stub").exists()).toBe(true);
    await open.trigger("click");
    await open.trigger("click");
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("当前卷置顶、显示工作台最新标题并带 aria-current；最近问卷随后", async () => {
    const list = makeList([
      summary({ id: "s-2", title: "问卷乙", status: "published", completedCount: 4 }),
      summary({ id: "s-1", title: "旧标题", status: "draft", completedCount: 0 }),
    ]);
    const { wrapper } = await mountSwitcher(list);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    const rows = wrapper.findAll(".switcher-links button");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("当前卷新标题");
    expect(rows[0]!.attributes("aria-current")).toBe("page");
    expect(rows[1]!.text()).toContain("问卷乙");
    expect(rows[1]!.attributes("aria-current")).toBeUndefined();
    wrapper.unmount();
  });

  it("按标题过滤；选择其他卷走 host.navigate，点当前卷不导航", async () => {
    const list = makeList([
      summary({ id: "s-2", title: "问卷乙", status: "published", completedCount: 4 }),
      summary({ id: "s-3", title: "访谈前期", status: "draft", completedCount: 1 }),
    ]);
    const { navigate, wrapper } = await mountSwitcher(list);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="搜索问卷标题"]').setValue("访谈");
    const rows = wrapper.findAll(".switcher-links button");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text()).toContain("访谈前期");

    await wrapper.find('input[aria-label="搜索问卷标题"]').setValue("");
    await wrapper.findAll(".switcher-links button").find((b) => b.text().includes("问卷乙"))!.trigger("click");
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.detail", surveyId: "s-2" });
    // 选择后面板收起：重开（缓存未作废，不重拉）再点当前卷。
    navigate.mockClear();
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    await wrapper.findAll(".switcher-links button").find((b) => b.attributes("aria-current") === "page")!.trigger("click");
    expect(navigate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("底部「查看全部问卷」与标题区「返回问卷列表」都直达列表页", async () => {
    const list = makeList([summary({ id: "s-2", title: "问卷乙" })]);
    const { navigate, wrapper } = await mountSwitcher(list);
    await triggers(wrapper).back.trigger("click");
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.list" });
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text() === "查看全部问卷")!.trigger("click");
    expect(navigate).toHaveBeenLastCalledWith({ name: "surveys.list" });
    wrapper.unmount();
  });

  it("加载失败显示错误与重试；重试成功后列表可用；卸载无残留报错", async () => {
    const list = vi.fn()
      .mockImplementationOnce(async () => { throw new Error("offline"); })
      .mockResolvedValueOnce({ items: [summary({ id: "s-2", title: "问卷乙" })] });
    const { wrapper } = await mountSwitcher(list as never);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("操作未完成，请重试。");
    // 失败不缓存：items 已被清空，重开会重新拉取。
    await wrapper.findAll("button").find((b) => b.text() === "重新加载")!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".popover-stub").text()).toContain("问卷乙");
    wrapper.unmount();
  });

  it("列表只有当前卷时只渲染当前行；过滤无结果给无匹配文案", async () => {
    const list = makeList([summary({ id: "s-1", title: "旧标题" })]);
    const { wrapper } = await mountSwitcher(list);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    const rows = wrapper.findAll(".switcher-links button");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attributes("aria-current")).toBe("page");
    await wrapper.find('input[aria-label="搜索问卷标题"]').setValue("不存在的标题");
    expect(wrapper.text()).toContain("没有匹配的问卷");
    wrapper.unmount();
  });

  it("当前卷不在 api 返回：只显示工作台标题，不虚构状态与计数", async () => {
    const list = makeList([
      summary({ id: "s-2", title: "问卷乙", status: "published", completedCount: 4 }),
    ]);
    const { wrapper } = await mountSwitcher(list);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    const currentRow = wrapper.findAll(".switcher-links button")[0]!;
    expect(currentRow.text()).toContain("当前卷新标题");
    expect(currentRow.find(".switcher-meta").exists()).toBe(false);
    expect(currentRow.text()).not.toContain(t("surveys.responsesCount", { n: 0 }));
    wrapper.unmount();
  });

  it("跨卷后缓存作废：currentId 变化后重开面板重新拉取", async () => {
    const list = makeList([summary({ id: "s-2", title: "问卷乙", status: "published", completedCount: 4 })]);
    const { wrapper } = await mountSwitcher(list);
    const { open } = triggers(wrapper);
    await open.trigger("click");
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
    await open.trigger("click"); // 收起面板
    await wrapper.setProps({ currentId: "s-2", currentTitle: "问卷乙" });
    await open.trigger("click");
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("选中其他卷后面板收起再导航", async () => {
    const list = makeList([summary({ id: "s-2", title: "问卷乙" })]);
    const { navigate, wrapper } = await mountSwitcher(list);
    await triggers(wrapper).open.trigger("click");
    await flushPromises();
    expect(wrapper.find(".popover-stub").exists()).toBe(true);
    await wrapper
      .findAll(".switcher-links button")
      .find((b) => b.text().includes("问卷乙"))!
      .trigger("click");
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.detail", surveyId: "s-2" });
    expect(wrapper.find(".popover-stub").exists()).toBe(false);
    wrapper.unmount();
  });
});
