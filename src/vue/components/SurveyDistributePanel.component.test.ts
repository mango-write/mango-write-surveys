import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";
import SurveyDistributePanel from "./SurveyDistributePanel.vue";

const confirmMocks = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("primevue/useconfirm", () => ({
  useConfirm: () => ({ require: confirmMocks.require }),
}));

function mount(status: "published" | "paused" | "closed" = "published") {
  const success = vi.fn();
  const wrapper = mountSurveysComponent(SurveyDistributePanel, {
    props: {
      slug: "survey-share-id",
      status,
      completedCount: 5,
      startedCount: 8,
      responseLimit: 20,
      canWrite: true,
    },
  }, createTestHost({ notify: { success, error: vi.fn(), info: vi.fn() } }));
  return { wrapper, success };
}

describe("发放与回收管理", () => {
  it("分享、指标与进度使用同一份回收数据", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { wrapper, success } = mount();
    await vi.waitFor(() => expect(wrapper.find(".share-qr").exists()).toBe(true));
    expect(wrapper.find(".distribute-metrics").text()).toContain("完成率");
    expect(wrapper.find(".metric--rate").text()).toContain("63");
    expect(wrapper.find(".progress-count").text()).toBe("5 / 20 份");
    expect(wrapper.find(".progress-caption").text()).toContain("还可回收 15 份");

    await wrapper.findAll("button").find((button) => button.text() === "复制链接")!.trigger("click");
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/survey-share-id`);
    expect(success).toHaveBeenCalledWith("链接已复制");
    wrapper.unmount();
  });

  it("暂停与关闭只上报一次，关闭确认由工作台统一处理", async () => {
    const { wrapper } = mount();
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "暂停新作答")!.trigger("click");
    expect(wrapper.emitted("change")).toEqual([["paused"]]);
    await wrapper.findAll("button").find((button) => button.text() === "关闭回收")!.trigger("click");
    expect(wrapper.emitted("close")).toEqual([[]]);
    expect(confirmMocks.require).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("暂停态提供恢复入口，关闭态不再提供状态操作", async () => {
    const paused = mount("paused");
    await paused.wrapper.findAll("button").find((button) => button.text() === "恢复新作答")!.trigger("click");
    expect(paused.wrapper.emitted("change")).toEqual([["published"]]);
    paused.wrapper.unmount();

    const closed = mount("closed");
    expect(closed.wrapper.find(".management-row__copy").text()).toContain("已停止所有提交");
    expect(closed.wrapper.findAll("button")).toHaveLength(1);
    closed.wrapper.unmount();
  });
});
