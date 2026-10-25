// 题目卡片互斥标记（issue #217）：多选题的 exclusive 选项在画布两种状态
// （选中就地编辑行 / 未选中只读预览行）都与作答页预览同款显示「互斥」chip，
// 文案复用 surveys.exclusive；普通选项不渲染。
// 图片选项编辑（issue #217）：缩略图上传/换图/删图与载荷保留。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

import type { SurveyQuestion } from "../../contracts/index.js";
import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveysWebHost } from "../host.js";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";

const i18n = createSurveysTestI18n();

const MEDIA_RECEIPT = {
  id: "file-new",
  surveyId: "s1",
  name: "pic.png",
  sha256: "a".repeat(64),
  mime: "image/png",
  bytes: 70,
  createdAt: "2026-10-23T00:00:00Z",
  url: "/api/surveys/s1/media/file-new",
};

// host 注入式：uploadMedia 走 transport 的 multipart 通道，用例按 path/method 拦。
function makeHost(): { host: SurveysWebHost; upload: ReturnType<typeof vi.fn> } {
  const upload = vi.fn(async () => MEDIA_RECEIPT);
  const host = createTestHost({
    transport: {
      request: (async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/media") && init?.method === "POST") return upload();
        throw new Error(`用例未覆盖的 transport 请求：${init?.method ?? "GET"} ${path}`);
      }) as never,
    },
  });
  return { host, upload };
}

const t = (key: string) => i18n.global.t(key);

function multipleQuestion(exclusive = true): SurveyQuestion {
  return {
    id: "q1",
    type: "multiple",
    title: "信息渠道",
    required: false,
    options: [
      { id: "a", label: "邮件" },
      { id: "b", label: "短信", ...(exclusive ? { exclusive: true } : {}) },
    ],
  };
}

function imageQuestion(): SurveyQuestion {
  return {
    id: "q2",
    type: "image_single",
    title: "选方案",
    required: false,
    options: [
      { id: "p1", label: "方案一", imageFileId: "file-1" },
      { id: "p2", label: "方案二" },
    ],
  };
}

async function renderCard(
  question: SurveyQuestion,
  selected: boolean,
  extraProps: Record<string, unknown> = {},
  host?: SurveysWebHost,
) {
  const wrapper = mountSurveysComponent(
    SurveyQuestionCard,
    {
      props: { question, number: 1, selected, conditionSources: [], ...extraProps },
    },
    host,
  );
  await flushPromises();
  return wrapper;
}

describe("SurveyQuestionCard 互斥标记（issue #217）", () => {
  it("未选中卡（只读预览）：exclusive 选项显示互斥 chip，普通选项不显示", async () => {
    const wrapper = await renderCard(multipleQuestion(), false);
    const chips = wrapper.findAll(".exclusive-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toBe(t("surveys.exclusive"));
    // chip 落在 exclusive 选项所在行。
    expect(chips[0]!.element.parentElement?.textContent).toContain("短信");
  });

  it("选中卡（就地编辑行）：exclusive 选项同样显示互斥 chip", async () => {
    const wrapper = await renderCard(multipleQuestion(), true);
    const chips = wrapper.findAll(".exclusive-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toBe(t("surveys.exclusive"));
  });

  it("没有互斥选项时不渲染 chip", async () => {
    const question = multipleQuestion(false);
    for (const selected of [false, true]) {
      const wrapper = await renderCard(question, selected);
      expect(wrapper.findAll(".exclusive-chip")).toHaveLength(0);
    }
  });
});

describe("SurveyQuestionCard 图片选项（issue #217）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未选中卡（只读预览）：选项瓦片经认证侧前缀解析缩略图", async () => {
    const { host } = makeHost();
    const wrapper = await renderCard(imageQuestion(), false, { surveyId: "s1" }, host);
    const tiles = wrapper.findAll(".image-option");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.find("img").attributes("src")).toBe("/api/surveys/s1/media/file-1");
    expect(tiles[1]!.find("img").exists()).toBe(false);
  });

  it("选中卡：每选项渲染上传钮（换图入口），带图选项可删图——删图剥掉 imageFileId", async () => {
    const { host } = makeHost();
    const wrapper = await renderCard(imageQuestion(), true, { surveyId: "s1" }, host);
    const thumbs = wrapper.findAll(".opt-thumb");
    expect(thumbs).toHaveLength(2);
    // 无 surveyId（如纯展示语境）不上传钮。
    const noUpload = await renderCard(imageQuestion(), true);
    expect(noUpload.findAll(".opt-thumb")).toHaveLength(0);

    await wrapper.findAll(".opt-row")[0]!.findAll("button")
      .filter((b) => b.attributes("aria-label") === t("surveys.optionImageRemove"))[0]!
      .trigger("click");
    const emitted = wrapper.emitted("change")?.at(-1)?.[0] as SurveyQuestion;
    if (emitted.type !== "image_single") throw new Error("fixture");
    expect(emitted.options[0]).not.toHaveProperty("imageFileId");
    expect(emitted.options[0]!.label).toBe("方案一");
    expect(emitted.options[1]!.label).toBe("方案二");
  });

  it("上传：file input 变更后走 transport 上传通道，把回执 id 写进选项", async () => {
    const { host, upload } = makeHost();
    const wrapper = await renderCard(imageQuestion(), true, { surveyId: "s1" }, host);
    const input = wrapper.find("input.opt-file-input");
    // jsdom 没有 File 构造器赐 value 的通道：直接造 File 对象放进 input.files。
    const file = new File(["bytes"], "pic.png", { type: "image/png" });
    Object.defineProperty(input.element, "files", { value: [file] });
    // 先把上传目标指到选项 p2（真实流程由 pickImage 设置）。
    await wrapper.findAll(".opt-thumb")[1]!.trigger("click");
    await input.trigger("change");
    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    const emitted = wrapper.emitted("change")?.at(-1)?.[0] as SurveyQuestion;
    if (emitted.type !== "image_single") throw new Error("fixture");
    expect(emitted.options[1]!.imageFileId).toBe("file-new");
    expect(emitted.options[0]!.imageFileId).toBe("file-1");
  });
});
