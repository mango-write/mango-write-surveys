import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";
import SurveyNavigator from "./SurveyNavigator.vue";
import InputText from "primevue/inputtext";

describe("工作台问卷导航", () => {
  it("当前卷高亮，切换和新建均经宿主导航", async () => {
    const navigate = vi.fn();
    const request = vi.fn(async (_path: string, init?: { method?: string; body?: unknown }) => init?.method === "POST" ? { id: "new" } : { items: [{ id: "a", title: "卷 A" }, { id: "b", title: "卷 B" }] });
    const wrapper = mountSurveysComponent(SurveyNavigator, { props: { currentId: "a", currentTitle: "新标题" } }, createTestHost({ transport: { request: request as never }, navigate }));
    await flushPromises();
    expect(wrapper.find('[aria-current="page"]').text()).toBe("新标题");
    await wrapper.findAll("button").find(b => b.text() === "卷 B")!.trigger("click");
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.detail", surveyId: "b" });
    await wrapper.findAll("button").find(b => b.text() === "新建问卷")!.trigger("click");
    await wrapper.findComponent(InputText).setValue("新课题");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(request).toHaveBeenCalledWith("/api/surveys", { method: "POST", body: { title: "新课题" } });
    expect(navigate).toHaveBeenLastCalledWith({ name: "surveys.detail", surveyId: "new" });
    wrapper.unmount();
  });
  it("加载失败可重试，创建失败保留名称", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [] }).mockRejectedValueOnce(new Error("offline"));
    const wrapper = mountSurveysComponent(SurveyNavigator, { props: { currentId: "a" } }, createTestHost({ transport: { request } }));
    await flushPromises();
    await wrapper.findAll("button").find(b => b.text() === "重新加载")!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find(b => b.text() === "新建问卷")!.trigger("click");
    await wrapper.findComponent(InputText).setValue("保留名称");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.findComponent(InputText).props("modelValue")).toBe("保留名称");
    wrapper.unmount();
  });
});
