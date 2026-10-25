import { describe, expect, it } from "vitest";

import type { SurveyDefinition, SurveyQuestion } from "../../contracts/index.js";

import {
  changeQuestionType,
  duplicateQuestion,
  insertPageAfter,
  insertQuestion,
  isDefaultOptionLabel,
  makePage,
  makeQuestion,
  moveQuestionTo,
  moveQuestionWithin,
  removePage,
  removeQuestionRef,
  restoreTypePayload,
  typePayloadOf,
  withQuestion,
} from "./definition-ops";
import { createSurveysTestI18n } from "../test-mount.js";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  key === "surveys.newQuestion"
    ? "新题目"
    : key === "surveys.pageNumber"
      ? `第 ${params?.n} 页`
      : key;

// makeQuestion 的默认文案走真实 locale（NPS 锚点、Likert 预设），用 stub t 只会回 key。
const realT = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

function definition(): SurveyDefinition {
  return {
    version: 1,
    title: "问卷",
    description: "",
    consent: "",
    questions: [
      {
        id: "q1",
        type: "single",
        title: "年级",
        required: true,
        options: [
          { id: "o1", label: "大一" },
          { id: "o2", label: "大二" },
        ],
      },
      { id: "q2", type: "text", title: "备注", required: false },
      {
        id: "q3",
        type: "scale",
        title: "满意度",
        required: false,
        min: 1,
        max: 5,
      },
    ],
    pages: [
      { id: "p1", title: "一", questionIds: ["q1", "q2"] },
      { id: "p2", title: "二", questionIds: ["q3"] },
    ],
  };
}

const pageOrder = (def: SurveyDefinition) =>
  def.pages.flatMap((page) => page.questionIds);

describe("definition-ops（画布纯变换）", () => {
  it("insertQuestion 在指定页指定位置插入，questions 数组按页序重建", () => {
    const def = definition();
    const next = insertQuestion(
      def,
      "p2",
      { id: "q9", type: "number", title: "年龄", required: false },
      0,
    );
    expect(next.pages[1]!.questionIds).toEqual(["q9", "q3"]);
    expect(next.questions.map((q) => q.id)).toEqual(["q1", "q2", "q9", "q3"]);
    expect(def.pages[1]!.questionIds).toEqual(["q3"]);
  });

  it("单选↔多选保留选项原样；其余换题型保留题干/必答/showIf，载荷按新题型生成默认值", () => {
    const def = definition();
    const q1 = def.questions[0]!;
    const next = changeQuestionType(q1, "multiple", t);
    expect(next.id).toBe("q1");
    expect(next.type).toBe("multiple");
    expect(next.title).toBe("年级");
    expect(next.required).toBe(true);
    expect(next.type === "multiple" && next.options).toEqual(
      q1.type === "single" && q1.options,
    );

    const q2 = def.questions[1]!;
    q2.showIf = { questionId: "q1", op: "eq", value: "o1" };
    const kept = changeQuestionType(q2, "number", t);
    expect(kept.showIf).toEqual({ questionId: "q1", op: "eq", value: "o1" });
    expect(kept.type === "number" && kept.min).toBeUndefined();
    expect(kept.type === "number" && kept.max).toBeUndefined();
  });

  it("typePayloadOf / restoreTypePayload：载荷换下与切回恢复（题干/必答/showIf 用当前值）", () => {
    const def = definition();
    const q3 = def.questions[2]!; // scale 1..5
    expect(typePayloadOf(q3)).toEqual({ type: "scale", min: 1, max: 5 });

    // 换到 text 期间改了题干；切回 scale：载荷恢复，题干保留 text 期间的值。
    const duringText = changeQuestionType(q3, "text", t);
    const edited = { ...duringText, title: "满意度（改）" };
    const restored = restoreTypePayload(q3, edited);
    expect(restored).toMatchObject({
      id: "q3",
      type: "scale",
      title: "满意度（改）",
      min: 1,
      max: 5,
    });
    // text 期间的载荷（multiline/maxLength）不得残留。
    expect(restored).not.toHaveProperty("multiline");
    expect(restored).not.toHaveProperty("maxLength");

    const q1 = def.questions[0]!;
    if (q1.type !== "single") throw new Error("fixture");
    expect(typePayloadOf(q1)).toEqual({ type: "single", options: q1.options });
    // fixture 的 text 题未设多行/字数上限：载荷只含 type。
    const textQ = def.questions[1]!;
    expect(typePayloadOf(textQ)).toEqual({ type: "text" });
  });

  it("复制题目：新 id + 选项重新生成 id，插在原题后", () => {
    const def = definition();
    const { definition: next, newId } = duplicateQuestion(def, "q1");
    expect(newId).not.toBe("q1");
    expect(next.pages[0]!.questionIds).toEqual(["q1", newId, "q2"]);
    const original = def.questions[0]!;
    const copy = next.questions.find((q) => q.id === newId)!;
    if (copy.type !== "single" || original.type !== "single")
      throw new Error("fixture");
    expect(copy.options.map((option) => option.label)).toEqual(
      original.options.map((option) => option.label),
    );
    expect(
      copy.options.every(
        (option) => !original.options.some((o) => o.id === option.id),
      ),
    ).toBe(true);
  });

  it("删除题目：清理页引用、指向它的 showIf 与跳页设置", () => {
    const def = definition();
    def.questions[1]!.showIf = { questionId: "q1", op: "eq", value: "o1" };
    def.pages[1]!.jump = {
      when: { questionId: "q1", op: "eq", value: "o1" },
      targetPageId: "p2",
    };
    const next = removeQuestionRef(def, "q1");
    expect(next.questions.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(pageOrder(next)).toEqual(["q2", "q3"]);
    expect(next.questions[0]!.showIf).toBeUndefined();
    expect(next.pages[1]!.jump).toBeUndefined();
  });

  it("页内移动（键盘兜底）与跨页拖拽落点一致", () => {
    const def = definition();
    const moved = moveQuestionWithin(def, "q2", -1);
    expect(moved.pages[0]!.questionIds).toEqual(["q2", "q1"]);

    const cross = moveQuestionTo(def, "q2", "p2", 1);
    expect(cross.pages[0]!.questionIds).toEqual(["q1"]);
    expect(cross.pages[1]!.questionIds).toEqual(["q3", "q2"]);
    expect(cross.questions.map((q) => q.id)).toEqual(["q1", "q3", "q2"]);

    // 同页向下拖：目标 index 在原位之后时左移一位。
    const down = moveQuestionTo(def, "q1", "p1", 2);
    expect(down.pages[0]!.questionIds).toEqual(["q2", "q1"]);
  });

  it("空页保留在草稿里；删除页时题目移入相邻页、指向它的跳页删除", () => {
    let def = definition();
    def = insertPageAfter(def, null, t);
    expect(def.pages.map((page) => page.title)).toEqual(["一", "二", "第 3 页"]);
    expect(def.pages[2]!.questionIds).toEqual([]);

    def = insertPageAfter(def, "p1", t);
    def.pages[1]!.questionIds = [];
    def.pages[2]!.jump = {
      when: { questionId: "q1", op: "eq", value: "o1" },
      targetPageId: "p1",
    };
    const removed = removePage(def, def.pages[1]!.id);
    expect(removed.pages).toHaveLength(3);
    // p1 的题目并入相邻页（原 p1 在中间：后一页优先）。
    expect(removed.pages.flatMap((page) => page.questionIds).sort()).toEqual(
      ["q1", "q2", "q3"].sort(),
    );
    expect(removed.pages.every((page) => page.jump?.targetPageId !== def.pages[1]!.id)).toBe(
      true,
    );
  });

  it("withQuestion 只替换目标题且不改动其余引用", () => {
    const def = definition();
    const q3 = def.questions[2]!;
    if (q3.type !== "scale") throw new Error("fixture");
    const next = withQuestion(def, "q3", { ...q3, min: 0 });
    expect(next.questions[2]).toMatchObject({ min: 0 });
    expect(next.questions[0]).toBe(def.questions[0]);
    expect(next.pages).toBe(def.pages);
  });

  it("makePage 生成带默认标题的空页", () => {
    expect(makePage(t, 4)).toMatchObject({ title: "第 4 页", questionIds: [] });
  });

  it("isDefaultOptionLabel 只认 zh/en 自动生成的「选项 N / Option N」", () => {
    for (const label of ["选项 1", "选项 12", "Option 2", "Option 30"]) {
      expect(isDefaultOptionLabel(label)).toBe(true);
    }
    for (const label of [
      "选项 1测试选项",
      "大一",
      "选项1",
      "选项",
      "option 3",
      "Option",
      "",
    ]) {
      expect(isDefaultOptionLabel(label)).toBe(false);
    }
  });

  it("isDefaultOptionLabel 覆盖行/列/项默认文案", () => {
    for (const label of ["行 1", "行 12", "列 3", "项 2", "Row 4", "Column 5", "Item 6"]) {
      expect(isDefaultOptionLabel(label)).toBe(true);
    }
    for (const label of ["行1", "行 内容", "非常不同意", "Column", "row 2"]) {
      expect(isDefaultOptionLabel(label)).toBe(false);
    }
  });

  it("makeQuestion：新题型默认载荷", () => {
    const rating = makeQuestion("rating", realT);
    expect(rating).toMatchObject({ type: "rating", max: 5, required: false });

    const nps = makeQuestion("nps", realT);
    if (nps.type !== "nps") throw new Error("fixture");
    expect(nps.minLabel).toBe("完全不可能");
    expect(nps.maxLabel).toBe("极有可能");

    const matrix = makeQuestion("matrix_single", realT);
    if (matrix.type !== "matrix_single") throw new Error("fixture");
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.columns).toHaveLength(5);
    expect(matrix.columns.map((c) => c.label)).toEqual([
      "非常不同意",
      "不同意",
      "一般",
      "同意",
      "非常同意",
    ]);
    const multi = makeQuestion("matrix_multiple", realT);
    if (multi.type !== "matrix_multiple") throw new Error("fixture");
    expect(multi.rows).toHaveLength(2);
    expect(multi.columns).toHaveLength(3);

    const items = makeQuestion("multi_text", realT);
    if (items.type !== "multi_text") throw new Error("fixture");
    expect(items.items).toHaveLength(2);

    const statement = makeQuestion("statement", realT);
    expect(statement).toMatchObject({ type: "statement", title: "", body: "", required: false });
  });

  it("换题型：选项族（单选/下拉/多选/排序）保留 options；矩阵族保留 rows/columns", () => {
    const single = definition().questions[0]!;
    if (single.type !== "single") throw new Error("fixture");
    const ranking = changeQuestionType(single, "ranking", t);
    if (ranking.type !== "ranking") throw new Error("fixture");
    expect(ranking.options).toEqual(single.options);

    const matrix: SurveyQuestion = {
      id: "mx",
      type: "matrix_single",
      title: "矩阵",
      required: false,
      rows: [
        { id: "r1", label: "行 1" },
        { id: "r2", label: "行 2" },
      ],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    };
    const multiMatrix = changeQuestionType(matrix, "matrix_multiple", t);
    if (multiMatrix.type !== "matrix_multiple") throw new Error("fixture");
    expect(multiMatrix.rows).toEqual(matrix.rows);
    expect(multiMatrix.columns).toEqual(matrix.columns);

    // 矩阵 → 单选：载荷换新（默认选项），题干/必答保留。
    const toSingle = changeQuestionType(matrix, "single", t);
    if (toSingle.type !== "single") throw new Error("fixture");
    expect(toSingle.title).toBe("矩阵");
    expect(toSingle.options).toHaveLength(2);
    expect(toSingle).not.toHaveProperty("rows");
  });

  it("typePayloadOf / restoreTypePayload：新题型载荷换下与恢复", () => {
    const matrix: SurveyQuestion = {
      id: "mx",
      type: "matrix_single",
      title: "矩阵",
      required: false,
      rows: [{ id: "r1", label: "行 1" }],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    };
    expect(typePayloadOf(matrix)).toEqual({
      type: "matrix_single",
      rows: matrix.rows,
      columns: matrix.columns,
    });
    const during = changeQuestionType(matrix, "text", t);
    const restored = restoreTypePayload(matrix, { ...during, title: "改" });
    expect(restored).toMatchObject({ type: "matrix_single", title: "改" });
    expect(restored).not.toHaveProperty("multiline");

    const rating: SurveyQuestion = { id: "ra", type: "rating", title: "评", required: false, max: 7 };
    expect(typePayloadOf(rating)).toEqual({ type: "rating", max: 7 });
    const nps: SurveyQuestion = {
      id: "np",
      type: "nps",
      title: "n",
      required: false,
      minLabel: "低",
      maxLabel: "高",
    };
    expect(typePayloadOf(nps)).toEqual({ type: "nps", minLabel: "低", maxLabel: "高" });
  });

  it("复制题目：新题型载荷的行/列/项 id 重新生成", () => {
    const def = definition();
    def.questions.push({
      id: "mx",
      type: "matrix_single",
      title: "矩阵",
      required: false,
      rows: [{ id: "r1", label: "行 1" }],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    });
    def.pages[0]!.questionIds.push("mx");
    const { definition: next, newId } = duplicateQuestion(def, "mx");
    const copy = next.questions.find((q) => q.id === newId)!;
    if (copy.type !== "matrix_single") throw new Error("fixture");
    expect(copy.rows[0]!.label).toBe("行 1");
    expect(copy.rows[0]!.id).not.toBe("r1");
    expect(copy.columns.map((c) => c.label)).toEqual(["不同意", "同意"]);
    expect(copy.columns.map((c) => c.id)).not.toEqual(["c1", "c2"]);
  });
});
