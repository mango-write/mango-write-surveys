import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

import SurveyPretestPage from "./SurveyPretestPage.vue";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";

const token = "a".repeat(43);
const definition = {
  version: 1, title: "试填问卷", description: "研究说明", consent: "自愿作答",
  questions: [{ id: "q1", type: "text", title: "你的回答", required: true }],
  pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
};

describe("独立试填页面", () => {
  it("告知保留期限并要求同意，验证答卷后提交题目反馈", async () => {
    const request = vi.fn(async (path: string, _init?: { body?: unknown }) =>
      path.endsWith("/responses") ? { id: "response", completedAt: "2026-10-28T00:00:00Z" } : { definition, expiresAt: "2026-11-04T00:00:00Z", answerRetentionDays: 30 },
    );
    const wrapper = mountSurveysComponent(SurveyPretestPage, { props: { token } }, createTestHost({ transport: { request: request as never } }));
    await flushPromises();
    expect(wrapper.text()).toContain("30 天");
    expect(wrapper.text()).toContain("自愿作答");
    const start = wrapper.findAll("button").find((button) => button.text() === "开始填写")!;
    expect(start.attributes("disabled")).toBeDefined();
    await wrapper.find('[role="checkbox"]').trigger("click");
    await start.trigger("click");
    await wrapper.findAll("button").find((button) => button.text() === "提交答卷")!.trigger("click");
    expect(request).toHaveBeenCalledTimes(1);
    await wrapper.find("input#q1").setValue("答复");
    await wrapper.find("textarea").setValue("这里有歧义");
    await wrapper.findAll("button").find((button) => button.text() === "提交答卷")!.trigger("click");
    await flushPromises();
    expect(request.mock.calls[1]![1]?.body).toMatchObject({
      token, submission: { consent: true, answers: { q1: "答复" },
        feedback: [{ questionId: "q1", aspect: "general", note: "这里有歧义" }] },
    });
    expect(wrapper.text()).toContain("试填已提交");
    wrapper.unmount();
  });

  it("图片凭证只放请求体，失败时不能提交且可重试；离开时释放临时图片", async () => {
    const fileId = "00000000-0000-4000-8000-000000000001";
    const imageDefinition = { ...definition, questions: [{ id: "q1", type: "image_single", title: "选择图片", required: false, options: [{ id: "o1", label: "选项", imageFileId: fileId }] }] };
    const request = vi.fn(async (path: string, _init?: { body?: unknown; responseType?: "blob" }) => {
      if (path.endsWith("/read")) return { definition: imageDefinition, expiresAt: "2026-11-04T00:00:00Z", answerRetentionDays: 30 };
      if (path.includes("/assets/")) {
        if (request.mock.calls.filter((call) => call[0].includes("/assets/")).length === 1) throw new Error("offline");
        return new Blob(["image"], { type: "image/png" });
      }
      return { id: "response", completedAt: "2026-10-28T00:00:00Z" };
    });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const wrapper = mountSurveysComponent(SurveyPretestPage, { props: { token } }, createTestHost({ transport: { request: request as never } }));
    await flushPromises();
    await wrapper.find('[role="checkbox"]').trigger("click");
    await wrapper.findAll("button").find((button) => button.text() === "开始填写")!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("部分选项图片加载失败");
    expect(wrapper.findAll("button").find((button) => button.text() === "提交答卷")!.attributes("disabled")).toBeDefined();
    await wrapper.findAll("button").find((button) => button.text() === "重新加载图片")!.trigger("click");
    await flushPromises();
    expect(wrapper.find("img").attributes("src")).toBe("blob:test-image");
    expect(request.mock.calls.every(([path]) => !path.includes(token))).toBe(true);
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ body: { token }, responseType: "blob" });
    wrapper.unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:test-image");
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  });
});
