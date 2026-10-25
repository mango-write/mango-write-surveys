// 逐题摘要聚合的纯函数用例：各题型的展开变量口径见 surveys 包 core 的
// surveyVariables（与变量字典/CSV 同源），这里按同一口径造数据集。
import { describe, expect, it } from "vitest";
import type { SurveyDataset } from "./dataset";

import {
  summarizeDataset,
  type ChoiceSummary,
  type MatrixSummary,
  type NpsSummary,
  type NumberSummary,
  type OrdinalSummary,
  type RankingSummary,
  type TextSummary,
} from "./summary";

let responseSeq = 0;
function row(
  values: Record<string, unknown>,
  missing: Record<string, string> = {},
): SurveyDataset["rows"][number] {
  responseSeq += 1;
  return {
    responseId: `00000000-0000-4000-8000-${String(responseSeq).padStart(12, "0")}`,
    values: values as SurveyDataset["rows"][number]["values"],
    missing: missing as SurveyDataset["rows"][number]["missing"],
  };
}

function dataset(
  variables: SurveyDataset["variables"],
  rows: SurveyDataset["rows"],
  questionTypes?: SurveyDataset["questionTypes"],
): SurveyDataset {
  return {
    surveyId: "00000000-0000-4000-8000-000000000001",
    revisionId: "00000000-0000-4000-8000-000000000002",
    title: "Survey",
    variables,
    rows,
    responseCount: rows.length,
    ...(questionTypes ? { questionTypes } : {}),
  };
}

describe("summarizeDataset 单变量题", () => {
  it("单选题按选项计数，未回答单列，未展示不进基数", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "q1",
            label: "你从哪里得知？",
            kind: "categorical",
            options: [
              { id: "web", label: "官网" },
              { id: "friend", label: "朋友" },
            ],
          },
        ],
        [
          row({ q1: "web" }),
          row({ q1: "web" }),
          row({ q1: "friend" }),
          row({}, { q1: "unanswered" }),
          row({}, { q1: "not_displayed" }),
        ],
      ),
    );
    const summary = result[0] as ChoiceSummary;
    expect(summary.view).toBe("choice");
    expect(summary.multi).toBe(false);
    expect(summary.options).toEqual([
      { id: "web", label: "官网", count: 2 },
      { id: "friend", label: "朋友", count: 1 },
    ]);
    expect(summary.answered).toBe(3);
    expect(summary.unanswered).toBe(1);
  });

  it("多选题按人数计基数，同一答卷多个选项分别计数", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "q2",
            label: "看重哪些方面？",
            kind: "multiple",
            options: [
              { id: "price", label: "价格" },
              { id: "speed", label: "速度" },
            ],
          },
        ],
        [row({ q2: ["price", "speed"] }), row({ q2: ["price"] })],
      ),
    );
    const summary = result[0] as ChoiceSummary;
    expect(summary.multi).toBe(true);
    expect(summary.answered).toBe(2);
    expect(summary.options.map((o) => o.count)).toEqual([2, 1]);
  });

  it("量表按档位分布并给出均值", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "q3",
            label: "满意度",
            kind: "ordinal",
            options: [
              { id: "1", label: "1" },
              { id: "2", label: "2" },
              { id: "3", label: "3" },
              { id: "4", label: "4" },
              { id: "5", label: "5" },
            ],
          },
        ],
        [row({ q3: 1 }), row({ q3: 2 }), row({ q3: 2 }), row({ q3: 5 })],
      ),
    );
    const summary = result[0] as OrdinalSummary;
    expect(summary.view).toBe("ordinal");
    expect(summary.mean).toBe(2.5);
    expect(summary.buckets.map((b) => b.count)).toEqual([1, 2, 0, 0, 1]);
  });

  it("0–10 有序变量识别为 NPS 并给出三段占比与净值", () => {
    const npsOptions = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      label: String(i),
    }));
    const rows = [
      ...Array.from({ length: 3 }, () => row({ q4: 9 })),
      row({ q4: 7 }),
      row({ q4: 2 }),
      row({ q4: 0 }),
    ];
    const result = summarizeDataset(
      dataset([{ id: "q4", label: "推荐意愿", kind: "ordinal", options: npsOptions }], rows),
    );
    const summary = result[0] as NpsSummary;
    expect(summary.view).toBe("nps");
    expect(summary.promoters).toBe(3);
    expect(summary.passives).toBe(1);
    expect(summary.detractors).toBe(2);
    // (3 - 2) / 6 = 16.7
    expect(summary.netPercent).toBe(16.7);
  });

  it("数字题给出 min/max/均值与固定分桶（右端点入末桶）", () => {
    const result = summarizeDataset(
      dataset(
        [{ id: "age", label: "年龄", kind: "number" }],
        [
          row({ age: 10 }),
          row({ age: 20 }),
          row({ age: 30 }),
          row({ age: 80 }),
          row({ age: 90 }),
        ],
      ),
    );
    const summary = result[0] as NumberSummary;
    expect(summary.view).toBe("number");
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(90);
    expect(summary.mean).toBe(46);
    expect(summary.buckets).toHaveLength(8);
    // 桶宽 10：10 落第一桶，90 落最后桶。
    expect(summary.buckets[0]!.count).toBe(1);
    expect(summary.buckets[7]!.count).toBe(2);
    expect(summary.buckets.reduce((t, b) => t + b.count, 0)).toBe(5);
  });

  it("文本题按频次降序列举；空白文本与未回答都算未答", () => {
    const result = summarizeDataset(
      dataset([{ id: "note", label: "建议", kind: "text" }], [
        row({ note: "快点" }),
        row({ note: "快点" }),
        row({ note: "还行" }),
        row({ note: "  " }),
        row({}, { note: "unanswered" }),
        row({}, { note: "not_displayed" }),
      ]),
    );
    const summary = result[0] as TextSummary;
    expect(summary.view).toBe("text");
    expect(summary.entries).toEqual([
      { text: "快点", count: 2 },
      { text: "还行", count: 1 },
    ]);
    expect(summary.answered).toBe(3);
    expect(summary.unanswered).toBe(2);
  });

  it("日期题按值聚合频次", () => {
    const result = summarizeDataset(
      dataset([{ id: "d1", label: "开始日期", kind: "date" }], [
        row({ d1: "2026-01-01" }),
        row({ d1: "2026-01-01" }),
        row({ d1: "2026-02-01" }),
      ]),
    );
    expect(result[0]!.view).toBe("date");
    const summary = result[0] as TextSummary;
    expect(summary.entries[0]).toEqual({ text: "2026-01-01", count: 2 });
  });
});

describe("summarizeDataset 多变量题", () => {
  it("矩阵单选：组标题去公共前缀，每行一组档位分布（档位映射回列文案）", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "m1.r1",
            label: "满意度·速度",
            kind: "ordinal",
            options: [
              { id: "1", label: "不满意" },
              { id: "2", label: "满意" },
            ],
          },
          {
            id: "m1.r2",
            label: "满意度·界面",
            kind: "ordinal",
            options: [
              { id: "1", label: "不满意" },
              { id: "2", label: "满意" },
            ],
          },
        ],
        [row({ "m1.r1": 2 }), row({ "m1.r2": 1 })],
      ),
    );
    const summary = result[0] as MatrixSummary;
    expect(summary.view).toBe("matrix");
    expect(summary.title).toBe("满意度");
    expect(summary.rowView).toBe("ordinal");
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows[0]!.label).toBe("速度");
    expect(summary.rows[0]!.summary).toMatchObject({
      view: "ordinal",
      buckets: [
        { id: "1", count: 0 },
        { id: "2", count: 1 },
      ],
      answered: 1,
      unanswered: 1,
    });
    expect(summary.rows[1]!.summary).toMatchObject({ answered: 1, unanswered: 1 });
  });

  it("矩阵多选：每行一组多选计数", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "m2.r1",
            label: "使用了哪些功能·写作",
            kind: "multiple",
            options: [
              { id: "a", label: "功能A" },
              { id: "b", label: "功能B" },
            ],
          },
          {
            id: "m2.r2",
            label: "使用了哪些功能·文献",
            kind: "multiple",
            options: [
              { id: "a", label: "功能A" },
              { id: "b", label: "功能B" },
            ],
          },
        ],
        [row({ "m2.r1": ["a", "b"] }), row({ "m2.r2": ["a"] })],
      ),
    );
    const summary = result[0] as MatrixSummary;
    expect(summary.rowView).toBe("multi");
    expect(summary.rows[0]!.summary).toMatchObject({
      view: "choice",
      multi: true,
      answered: 1,
    });
    expect((summary.rows[0]!.summary as ChoiceSummary).options.map((o) => o.count)).toEqual([1, 1]);
  });

  it("矩阵填空与多项填空：每行答案列举（文本口径）", () => {
    const result = summarizeDataset(
      dataset(
        [
          { id: "m3.r1", label: "联系方式·邮箱", kind: "text" },
          { id: "m3.r2", label: "联系方式·电话", kind: "text" },
        ],
        [row({ "m3.r1": "a@x.dev", "m3.r2": "123" }), row({ "m3.r1": "b@x.dev" })],
      ),
    );
    const summary = result[0] as MatrixSummary;
    expect(summary.rowView).toBe("text");
    expect(summary.rows[0]!.label).toBe("邮箱");
    expect((summary.rows[0]!.summary as TextSummary).answered).toBe(2);
    expect((summary.rows[1]!.summary as TextSummary).answered).toBe(1);
  });

  it("排序题识别为平均位次视图（档位 1..n 与组大小一致）", () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));
    const result = summarizeDataset(
      dataset(
        [
          { id: "rk.a", label: "排序·界面", kind: "ordinal", options: options(3) },
          { id: "rk.b", label: "排序·速度", kind: "ordinal", options: options(3) },
          { id: "rk.c", label: "排序·价格", kind: "ordinal", options: options(3) },
        ],
        [
          row({ "rk.a": 1, "rk.b": 2, "rk.c": 3 }),
          row({ "rk.a": 2, "rk.b": 1, "rk.c": 3 }),
        ],
      ),
    );
    const summary = result[0] as RankingSummary;
    expect(summary.view).toBe("ranking");
    expect(summary.items.map((item) => item.label)).toEqual(["界面", "速度", "价格"]);
    expect(summary.items.map((item) => item.averageRank)).toEqual([1.5, 1.5, 3]);
    expect(summary.answered).toBe(2);
  });

  it("非方阵有序变量组按矩阵行分布呈现，不误判为排序", () => {
    const options = [
      { id: "1", label: "不同意" },
      { id: "2", label: "一般" },
      { id: "3", label: "同意" },
    ];
    const result = summarizeDataset(
      dataset(
        [
          { id: "mx.r1", label: "认同度·A", kind: "ordinal", options },
          { id: "mx.r2", label: "认同度·B", kind: "ordinal", options },
        ],
        [row({ "mx.r1": 3, "mx.r2": 1 })],
      ),
    );
    const summary = result[0] as MatrixSummary;
    expect(summary.view).toBe("matrix");
  });
});

describe("summarizeDataset 边界", () => {
  it("空数据集给出零计数骨架，不抛错", () => {
    const result = summarizeDataset(
      dataset(
        [{ id: "q1", label: "题", kind: "categorical", options: [{ id: "a", label: "A" }] }],
        [],
      ),
    );
    expect(result[0]).toMatchObject({ view: "choice", answered: 0, unanswered: 0 });
  });

  it("说明块不产生变量，不出现在摘要里", () => {
    const result = summarizeDataset(dataset([], [row({})]));
    expect(result).toEqual([]);
  });

  it("组标题：题干含「·」时仍取完整题干", () => {
    const options = [
      { id: "1", label: "1" },
      { id: "2", label: "2" },
    ];
    const result = summarizeDataset(
      dataset(
        [
          { id: "m9.r1", label: "总体评价·质量·速度", kind: "ordinal", options },
          { id: "m9.r2", label: "总体评价·质量·界面", kind: "ordinal", options },
        ],
        [row({})],
      ),
    );
    expect((result[0] as MatrixSummary).title).toBe("总体评价·质量");
  });
});

// 真实题型映射（issue #217 M1）：questionTypes 由 API 按发布定义投影，摘要
// 按它判型；映射缺失才回落形状启发式并标记 inferred。
describe("summarizeDataset 按发布定义真实题型", () => {
  const npsOptions = Array.from({ length: 11 }, (_, i) => ({
    id: String(i),
    label: String(i),
  }));
  const rows = [row({ q1: 9 }), row({ q1: 2 }), row({ q1: 5 })];

  it("0–10 量表题按 scale 呈现分布 + 均值，不被 NPS 化", () => {
    const result = summarizeDataset(
      dataset(
        [{ id: "q1", label: "满意度", kind: "ordinal", options: npsOptions }],
        rows,
        { q1: "scale" },
      ),
    );
    expect(result[0]).toMatchObject({
      view: "ordinal",
      questionType: "scale",
      inferred: false,
      mean: (9 + 2 + 5) / 3,
    });
  });

  it("同形状 + nps 题型给三段与净值", () => {
    const result = summarizeDataset(
      dataset(
        [{ id: "q1", label: "推荐意愿", kind: "ordinal", options: npsOptions }],
        rows,
        { q1: "nps" },
      ),
    );
    expect(result[0]).toMatchObject({
      view: "nps",
      questionType: "nps",
      inferred: false,
      promoters: 1,
      // 0–6 = 贬损：2 与 5；7–8 = 中立：无。
      detractors: 2,
      passives: 0,
    });
  });

  it("排序题按真实题型出平均位次，矩阵单选不再靠「标签是不是数字」猜", () => {
    // 矩阵列文案恰好是数字也不误判成排序：matrix_single 恒走矩阵视图。
    const numericColumns = [
      { id: "1", label: "1" },
      { id: "2", label: "2" },
      { id: "3", label: "3" },
    ];
    const result = summarizeDataset(
      dataset(
        [
          { id: "m1.r1", label: "评分·速度", kind: "ordinal", options: numericColumns },
          { id: "m1.r2", label: "评分·界面", kind: "ordinal", options: numericColumns },
        ],
        [row({ "m1.r1": 1, "m1.r2": 2 })],
        { m1: "matrix_single" },
      ),
    );
    expect(result[0]).toMatchObject({ view: "matrix", questionType: "matrix_single", inferred: false });

    // 反向：位次形状但题型缺映射 → 回落矩阵视图并标 inferred。
    const fallback = summarizeDataset(
      dataset(
        [
          { id: "m2.r1", label: "评分·速度", kind: "ordinal", options: numericColumns },
          { id: "m2.r2", label: "评分·界面", kind: "ordinal", options: numericColumns },
        ],
        [row({ "m2.r1": 1, "m2.r2": 2 })],
      ),
    );
    expect(fallback[0]).toMatchObject({ view: "matrix", questionType: null, inferred: true });
  });

  it("time 按 text 视图列举（徽章仍标 Time），题型缺映射才回落推断", () => {
    const vars: SurveyDataset["variables"] = [
      { id: "t1", label: "开始时间", kind: "text" },
    ];
    const typed = summarizeDataset(dataset(vars, [row({ t1: "09:30" })], { t1: "time" }));
    expect(typed[0]).toMatchObject({ view: "text", questionType: "time", inferred: false });

    const fallback = summarizeDataset(dataset(vars, [row({ t1: "09:30" })]));
    expect(fallback[0]).toMatchObject({ view: "text", questionType: null, inferred: true });
  });

  it("图片单选按 choice 视图计数（取值域只有选项 id）", () => {
    const result = summarizeDataset(
      dataset(
        [
          {
            id: "img1",
            label: "选一张图",
            kind: "categorical",
            options: [
              { id: "a", label: "图A" },
              { id: "b", label: "图B" },
            ],
          },
        ],
        [row({ img1: "a" })],
        { img1: "image_single" },
      ),
    );
    expect(result[0]).toMatchObject({ view: "choice", questionType: "image_single", inferred: false });
  });
});
