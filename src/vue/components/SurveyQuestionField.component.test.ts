// SurveyQuestionField 新题型控件（issue #217）：下拉/评分/NPS/日期/时间/
// 排序/矩阵/多项填空/说明块的作答渲染与值形状。值形状与 surveys 包 core 的
// SurveyAnswerValue 一一对应，这里是前端合成这些值的唯一入口。
import { describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";

import type { SurveyAnswers, SurveyQuestion } from "../../contracts/index.js";
import SurveyQuestionField from "./SurveyQuestionField.vue";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";

// 测试用最小 markdown 渲染（breaks + 粗体），只覆盖说明块断言所需的面。
const mdHost = () =>
  createTestHost({
    renderMarkdown: (source: string) =>
      source
        .split(/\n{2,}/)
        .map(
          (block) =>
            `<p>${block
              .split("\n")
              .join("<br>")
              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`,
        )
        .join(""),
  });

async function renderField(
  question: SurveyQuestion,
  modelValue?: SurveyAnswers[string],
) {
  const wrapper = mountSurveysComponent(
    SurveyQuestionField,
    {
      props: {
        question,
        ...(modelValue !== undefined ? { modelValue } : {}),
      },
    },
    mdHost(),
  );
  await flushPromises();
  return wrapper;
}

type FieldWrapper = Awaited<ReturnType<typeof renderField>>;
const lastEmit = (wrapper: FieldWrapper) =>
  (wrapper.emitted("update:modelValue")?.at(-1)?.[0] ?? undefined);

describe("SurveyQuestionField 新题型", () => {
  it("下拉：Select 选项渲染，选择发选项 id", async () => {
    const question: SurveyQuestion = {
      id: "q1",
      type: "dropdown",
      title: "来源",
      required: true,
      options: [
        { id: "a", label: "同学" },
        { id: "b", label: "网络" },
      ],
    };
    const wrapper = await renderField(question);
    expect(wrapper.find(".p-select").exists()).toBe(true);
    await wrapper.find(".p-select").trigger("click");
    await flushPromises();
    // Select 的浮层挂在 body（PrimeVue 默认 appendTo），且选项在 mousedown 选中。
    const option = [...document.querySelectorAll(".p-select-option")].at(1)!;
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(lastEmit(wrapper)).toBe("b");
  });

  it("评分：渲染 max 颗星（radio 组），点第 4 颗发数字 4", async () => {
    const question: SurveyQuestion = {
      id: "q2",
      type: "rating",
      title: "满意度",
      required: false,
      max: 5,
    };
    const wrapper = await renderField(question);
    const stars = wrapper.findAll(".rating-star");
    expect(stars).toHaveLength(5);
    await stars[3]!.find("input").setValue(true);
    expect(lastEmit(wrapper)).toBe(4);
  });

  it("NPS：0–10 一行 11 格，点格发数字；两端锚点文案渲染", async () => {
    const question: SurveyQuestion = {
      id: "q3",
      type: "nps",
      title: "推荐意愿",
      required: false,
      minLabel: "完全不可能",
      maxLabel: "极有可能",
    };
    const wrapper = await renderField(question);
    const cells = wrapper.findAll(".nps-cell");
    expect(cells).toHaveLength(11);
    expect(cells[0]!.text()).toBe("0");
    expect(wrapper.text()).toContain("完全不可能");
    await cells[8]!.find("input").setValue(true);
    expect(lastEmit(wrapper)).toBe(8);
  });

  it("日期/时间：原生 input 承载协议值，选中后回显本地格式，清空发 undefined", async () => {
    // 回显文案由界面 locale 决定：mountSurveysComponent 固定 zh-CN，断言整句。
    const dateQuestion: SurveyQuestion = {
      id: "q4",
      type: "date",
      title: "到访",
      required: false,
      min: "2026-01-01",
    };
    const wrapper = await renderField(dateQuestion);
    const input = wrapper.find("input[type='date']");
    expect(input.attributes("min")).toBe("2026-01-01");
    // 无值不回显。
    expect(wrapper.find(".date-echo").exists()).toBe(false);
    await input.setValue("2026-06-01");
    expect(lastEmit(wrapper)).toBe("2026-06-01");
    // 回显读 props.modelValue：宿主把 emit 的值回灌后才出现。
    await wrapper.setProps({ modelValue: "2026-06-01" });
    const echo = wrapper.find(".date-echo");
    expect(echo.exists()).toBe(true);
    expect(echo.text()).toBe("已选：2026年6月1日");
    await input.setValue("");
    expect(lastEmit(wrapper)).toBeUndefined();
    await wrapper.setProps({ modelValue: undefined });
    expect(wrapper.find(".date-echo").exists()).toBe(false);

    const timeQuestion: SurveyQuestion = {
      id: "q5",
      type: "time",
      title: "时间",
      required: false,
    };
    const wrapper2 = await renderField(timeQuestion);
    await wrapper2.find("input[type='time']").setValue("08:30");
    expect(lastEmit(wrapper2)).toBe("08:30");
  });

  it("排序：初始态不显名次不记答案，移动后才形成全排列", async () => {
    const question: SurveyQuestion = {
      id: "q6",
      type: "ranking",
      title: "排序",
      required: true,
      options: [
        { id: "a", label: "讲座" },
        { id: "b", label: "实验" },
        { id: "c", label: "研讨" },
      ],
    };
    const wrapper = await renderField(question);
    expect(wrapper.findAll(".ranking-item")).toHaveLength(3);
    // 初始态：无名次号（显示顺序 ≠ 已排序），也没答案发出。
    expect(wrapper.findAll(".ranking-rank")).toHaveLength(0);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    // 首次上移：把最后一项移到首位 → 发全排列 ["a", "c", "b"]，名次号出现。
    await wrapper.findAll(".ranking-item")[2]!.findAll(".ranking-btn")[0]!.trigger("click");
    expect(lastEmit(wrapper)).toEqual(["a", "c", "b"]);
    await wrapper.setProps({ modelValue: ["a", "c", "b"] });
    expect(wrapper.findAll(".ranking-rank")).toHaveLength(3);
    await wrapper.findAll(".ranking-item")[1]!.findAll(".ranking-btn")[0]!.trigger("click");
    expect(lastEmit(wrapper)).toEqual(["c", "a", "b"]);
    // 首项上移按钮禁用。
    expect(
      wrapper.findAll(".ranking-item")[0]!.findAll(".ranking-btn")[0]!.attributes("disabled"),
    ).toBeDefined();
  });

  it("矩阵单选：桌面表头 + 每行 radio 组；点选发 { rowId: columnId }", async () => {
    const question: SurveyQuestion = {
      id: "q7",
      type: "matrix_single",
      title: "评价",
      required: true,
      rows: [
        { id: "r1", label: "内容" },
        { id: "r2", label: "节奏" },
      ],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    };
    const wrapper = await renderField(question);
    expect(wrapper.findAll(".mx-head__cell")).toHaveLength(2);
    expect(wrapper.findAll(".mx-row")).toHaveLength(2);
    await wrapper
      .findAll(".mx-row")[0]!
      .findAll(".mx-cell")[1]!
      .find("input")
      .setValue(true);
    expect(lastEmit(wrapper)).toEqual({ r1: "c2" });
  });

  it("矩阵多选：勾选/取消同格发列 id 数组，全清发 undefined", async () => {
    const question: SurveyQuestion = {
      id: "q8",
      type: "matrix_multiple",
      title: "渠道",
      required: false,
      rows: [{ id: "r1", label: "线上" }],
      columns: [
        { id: "m1", label: "邮件" },
        { id: "m2", label: "短信" },
      ],
    };
    const wrapper = await renderField(question);
    const checkboxAt = (index: number) =>
      wrapper.findAll(".mx-cell")[index]!.find("input");
    await checkboxAt(0).setValue(true);
    expect(lastEmit(wrapper)).toEqual({ r1: ["m1"] });
    // 控件从 props 读已选集合：把上一发 emit 值回灌 props 再继续点。
    await wrapper.setProps({ modelValue: { r1: ["m1"] } });
    await checkboxAt(1).setValue(true);
    expect(lastEmit(wrapper)).toEqual({ r1: ["m1", "m2"] });
    await wrapper.setProps({ modelValue: { r1: ["m1", "m2"] } });
    await checkboxAt(0).setValue(false);
    expect(lastEmit(wrapper)).toEqual({ r1: ["m2"] });
    await wrapper.setProps({ modelValue: { r1: ["m2"] } });
    await checkboxAt(1).setValue(false);
    expect(lastEmit(wrapper)).toBeUndefined();
  });

  it("多项填空：每项一行；全空时发 undefined", async () => {
    const question: SurveyQuestion = {
      id: "q9",
      type: "multi_text",
      title: "联系方式",
      required: true,
      items: [
        { id: "i1", label: "邮箱" },
        { id: "i2", label: "电话" },
      ],
    };
    const wrapper = await renderField(question);
    const inputs = wrapper.findAll("input.p-inputtext");
    expect(inputs).toHaveLength(2);
    await inputs[0]!.setValue("a@x.test");
    expect(lastEmit(wrapper)).toEqual({ i1: "a@x.test" });
    await wrapper.setProps({ modelValue: { i1: "a@x.test" } });
    await inputs[1]!.setValue("123");
    expect(lastEmit(wrapper)).toEqual({ i1: "a@x.test", i2: "123" });
    await wrapper.setProps({ modelValue: { i1: "a@x.test", i2: "123" } });
    await inputs[1]!.setValue("");
    expect(lastEmit(wrapper)).toEqual({ i1: "a@x.test" });
  });

  it("矩阵填空：每行一个文本框，值形状与多项填空一致（issue #217）", async () => {
    const question: SurveyQuestion = {
      id: "q12",
      type: "matrix_text",
      title: "开放评价",
      required: true,
      rows: [
        { id: "r1", label: "优点" },
        { id: "r2", label: "不足" },
      ],
    };
    const wrapper = await renderField(question);
    const inputs = wrapper.findAll("input.p-inputtext");
    expect(inputs).toHaveLength(2);
    await inputs[0]!.setValue("快");
    expect(lastEmit(wrapper)).toEqual({ r1: "快" });
    await wrapper.setProps({ modelValue: { r1: "快" } });
    await inputs[1]!.setValue("慢");
    expect(lastEmit(wrapper)).toEqual({ r1: "快", r2: "慢" });
    await wrapper.setProps({ modelValue: { r1: "快", r2: "慢" } });
    await inputs[1]!.setValue("");
    expect(lastEmit(wrapper)).toEqual({ r1: "快" });
    // 无表头行（矩阵填空没有列）。
    expect(wrapper.find(".mx-head").exists()).toBe(false);
  });

  it("图片单选：瓦片渲染选项图（imageUrl 优先），点选发选项 id；无图选项落占位", async () => {
    const question: SurveyQuestion = {
      id: "q13",
      type: "image_single",
      title: "选方案",
      required: true,
      options: [
        { id: "p1", label: "方案一", imageUrl: "/api/survey-public/assets/f1" },
        { id: "p2", label: "方案二" },
      ],
    };
    const wrapper = await renderField(question);
    const tiles = wrapper.findAll(".image-option");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.find("img").attributes("src")).toBe(
      "/api/survey-public/assets/f1",
    );
    // 无图且无 mediaUrlBase：占位图标，不发虚地址。
    expect(tiles[1]!.find("img").exists()).toBe(false);
    await tiles[1]!.find("input").setValue(true);
    expect(lastEmit(wrapper)).toBe("p2");
  });

  it("图片多选：草稿期经 mediaUrlBase 解析缩略图；勾选/取消发 id 数组", async () => {
    const question: SurveyQuestion = {
      id: "q14",
      type: "image_multiple",
      title: "选图",
      required: false,
      options: [
        { id: "g1", label: "图一", imageFileId: "f1" },
        { id: "g2", label: "图二", imageFileId: "f2" },
      ],
    };
    const wrapper = mountSurveysComponent(
      SurveyQuestionField,
      {
        props: {
          question,
          mediaUrlBase: "/api/surveys/s1/media",
        },
      },
      mdHost(),
    );
    await flushPromises();
    const tiles = wrapper.findAll(".image-option");
    expect(tiles[0]!.find("img").attributes("src")).toBe("/api/surveys/s1/media/f1");
    await tiles[0]!.find("input").setValue(true);
    expect(lastEmit(wrapper)).toEqual(["g1"]);
    await wrapper.setProps({ modelValue: ["g1"] });
    await tiles[1]!.find("input").setValue(true);
    expect(lastEmit(wrapper)).toEqual(["g1", "g2"]);
    await wrapper.setProps({ modelValue: ["g1", "g2"] });
    await tiles[0]!.find("input").setValue(false);
    expect(lastEmit(wrapper)).toEqual(["g2"]);
  });

  it("说明块：渲染 markdown、无输入控件、必答星号不显示", async () => {
    const question: SurveyQuestion = {
      id: "q10",
      type: "statement",
      title: "",
      required: false,
      body: "**欢迎**参与",
    };
    const wrapper = await renderField(question);
    expect(wrapper.find(".statement-body").exists()).toBe(true);
    expect(wrapper.find(".statement-body").html()).toContain("<strong>");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("legend .tw\\:text-danger").exists()).toBe(false);
  });

  it("hideTitle（卡片预览）：题干不渲染，控件仍渲染", async () => {
    const question: SurveyQuestion = {
      id: "q11",
      type: "rating",
      title: "满意度",
      required: false,
      max: 5,
    };
    const wrapper = mountSurveysComponent(
      SurveyQuestionField,
      {
        props: { question, hideTitle: true, disabled: true },
      },
      mdHost(),
    );
    await flushPromises();
    expect(wrapper.find("legend").exists()).toBe(false);
    expect(wrapper.findAll(".rating-star")).toHaveLength(5);
  });

  it("invalidRow 定位：矩阵行与多项填空项就地标红", async () => {
    const matrix: SurveyQuestion = {
      id: "qm",
      type: "matrix_single",
      title: "评价",
      required: true,
      rows: [
        { id: "r1", label: "内容" },
        { id: "r2", label: "节奏" },
      ],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    };
    const plain = await renderField(matrix);
    expect(plain.findAll(".mx-row--invalid")).toHaveLength(0);
    const marked = mountSurveysComponent(
      SurveyQuestionField,
      { props: { question: matrix, invalidRow: "r2" } },
      mdHost(),
    );
    await flushPromises();
    expect(marked.findAll(".mx-row--invalid")).toHaveLength(1);
    expect(marked.findAll(".mx-row")[1]!.classes()).toContain("mx-row--invalid");

    const multiText: SurveyQuestion = {
      id: "qn",
      type: "multi_text",
      title: "联系方式",
      required: true,
      items: [
        { id: "i1", label: "邮箱" },
        { id: "i2", label: "电话" },
      ],
    };
    const markedItem = mountSurveysComponent(
      SurveyQuestionField,
      { props: { question: multiText, invalidRow: "i1" } },
      mdHost(),
    );
    await flushPromises();
    expect(markedItem.findAll(".mt-item--invalid")).toHaveLength(1);
    expect(markedItem.findAll(".mt-item")[0]!.classes()).toContain("mt-item--invalid");
  });
});
