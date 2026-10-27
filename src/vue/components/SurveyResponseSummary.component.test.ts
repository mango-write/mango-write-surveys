// 逐题摘要组件用例：各题型的呈现、空态、长文本收敛与展开。
import { describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";

import SurveyResponseSummary from "./SurveyResponseSummary.vue";
import type { SurveyDataset } from "../lib/dataset.js";
import { mountSurveysComponent } from "../test-mount.js";

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
  responseCount = rows.length,
  questionTypes?: SurveyDataset["questionTypes"],
): SurveyDataset {
  return {
    surveyId: "00000000-0000-4000-8000-000000000001",
    revisionId: "00000000-0000-4000-8000-000000000002",
    title: "Survey",
    variables,
    rows,
    responseCount,
    ...(questionTypes ? { questionTypes } : {}),
  };
}

async function render(ds: SurveyDataset, revisionNumber: number | null = 3) {
  const wrapper = mountSurveysComponent(SurveyResponseSummary, {
    props: { dataset: ds, revisionNumber },
  });
  await flushPromises();
  return wrapper;
}

describe("SurveyResponseSummary（issue #217）", () => {
  it("标注口径版本；0 份答卷给空态而不是一堆零卡片", async () => {
    const empty = await render(
      dataset(
        [{ id: "q1", label: "Q1", kind: "categorical", options: [{ id: "a", label: "A" }] }],
        [],
        0,
      ),
    );
    expect(empty.text()).toContain("还没有可摘要的答卷");
    expect(empty.find(".summary-card").exists()).toBe(false);
    empty.unmount();

    const withRows = await render(
      dataset([{ id: "q1", label: "Q1", kind: "categorical", options: [{ id: "a", label: "A" }] }], [
        row({ q1: "a" }),
      ]),
    );
    expect(withRows.text()).not.toContain("口径：发布版本 3");
    expect(withRows.findAll(".summary-card")).toHaveLength(1);
    withRows.unmount();
  });

  it("单选题渲染选项计数与占比条", async () => {
    const wrapper = await render(
      dataset(
        [
          {
            id: "q1",
            label: "Source",
            kind: "categorical",
            options: [
              { id: "web", label: "Web" },
              { id: "friend", label: "Friend" },
            ],
          },
        ],
        [row({ q1: "web" }), row({ q1: "web" }), row({ q1: "friend" })],
      ),
    );
    const card = wrapper.find(".summary-card");
    expect(card.text()).toContain("Web");
    expect(card.text()).toContain("2 · 66.7%");
    expect(card.text()).toContain("1 · 33.3%");
    expect(card.text()).toContain("已答 3 / 3");
    const bars = card.findAll(".bar-row");
    expect(bars[0]!.attributes("style")).toContain("--bar-color: var(--color-brand-500)");
    expect(bars[1]!.attributes("style")).toContain("--bar-color: var(--color-info-500)");
    wrapper.unmount();
  });

  it("NPS 给三段占比与净值（题型徽章 = 发布定义的真实题型）", async () => {
    const wrapper = await render(
      dataset(
        [
          {
            id: "q1",
            label: "Recommend",
            kind: "ordinal",
            options: Array.from({ length: 11 }, (_, i) => ({
              id: String(i),
              label: String(i),
            })),
          },
        ],
        [row({ q1: 9 }), row({ q1: 9 }), row({ q1: 7 }), row({ q1: 2 })],
        4,
        { q1: "nps" },
      ),
    );
    const card = wrapper.find(".summary-card");
    expect(card.text()).toContain("推荐者（9–10）");
    expect(card.text()).toContain("50%");
    expect(card.find(".summary-metric").text()).toBe("25NPS");
    expect(card.find(".nps-distribution").attributes("open")).toBeUndefined();
    // 徽章按发布定义题型，不出「按变量形状推断」角标。
    expect(card.find(".summary-kind").text()).toBe("NPS");
    expect(card.find(".summary-kind--inferred").exists()).toBe(false);
    wrapper.unmount();
  });

  it("0–10 量表按 scale 题型呈现分布 + 均值，不被 NPS 化（M1）", async () => {
    const wrapper = await render(
      dataset(
        [
          {
            id: "q1",
            label: "Satisfaction",
            kind: "ordinal",
            options: Array.from({ length: 11 }, (_, i) => ({
              id: String(i),
              label: String(i),
            })),
          },
        ],
        [row({ q1: 9 }), row({ q1: 2 })],
        2,
        { q1: "scale" },
      ),
    );
    const card = wrapper.find(".summary-card");
    expect(card.find(".summary-kind").text()).toBe("量表");
    expect(card.find(".summary-metric").text()).toBe("5.5均值");
    expect(card.find(".nps-segments").exists()).toBe(false);
    expect(card.find(".summary-kind--inferred").exists()).toBe(false);
    const bars = card.findAll(".bar-row");
    expect(bars).toHaveLength(11);
    expect(bars.every((bar) => bar.attributes("style")?.includes("--bar-color: var(--color-brand-500)"))).toBe(true);
    wrapper.unmount();
  });

  it("定义不可得时回落形状推断：NPS 卡带「按变量形状推断」角标，Time 显示 Time 徽章（M1/minor①）", async () => {
    const npsCard = await render(
      dataset(
        [
          {
            id: "q1",
            label: "Recommend",
            kind: "ordinal",
            options: Array.from({ length: 11 }, (_, i) => ({
              id: String(i),
              label: String(i),
            })),
          },
        ],
        [row({ q1: 9 }), row({ q1: 2 })],
      ),
    );
    const card = npsCard.find(".summary-card");
    // 回落口径仍按形状给 NPS 呈现，但角标明示这是推断。
    expect(card.find(".nps-segments").exists()).toBe(true);
    expect(card.find(".summary-kind--inferred").text()).toBe("按变量形状推断");
    npsCard.unmount();

    // minor①：Time 题徽章显示 Time（真实题型），不再英文错标 Text。
    const timeCard = await render(
      dataset([{ id: "t1", label: "Start", kind: "text" }], [row({ t1: "09:30" })], 1, {
        t1: "time",
      }),
    );
    expect(timeCard.find(".summary-card .summary-kind").text()).toBe("时间");
    timeCard.unmount();
  });

  it("文本回答默认收敛为前 10 条，可展开、可收起", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({ note: `answer ${i}` }));
    const wrapper = await render(
      dataset([{ id: "note", label: "Notes", kind: "text" }], rows),
    );
    let items = wrapper.findAll(".text-entries li");
    expect(items).toHaveLength(10);
    const expand = wrapper
      .findAll("button")
      .find((b) => b.text().includes("显示更多"))!;
    expect(expand.text()).toContain("还有 5 条");
    await expand.trigger("click");
    await flushPromises();
    items = wrapper.findAll(".text-entries li");
    expect(items).toHaveLength(15);
    const collapse = wrapper
      .findAll("button")
      .find((b) => b.text() === "收起")!;
    await collapse.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".text-entries li")).toHaveLength(10);
    wrapper.unmount();
  });

  it("矩阵题每行一组：行标签去掉题干前缀", async () => {
    const wrapper = await render(
      dataset(
        [
          {
            id: "m1.r1",
            label: "Satisfaction·Speed",
            kind: "ordinal",
            options: [
              { id: "1", label: "Bad" },
              { id: "2", label: "Good" },
            ],
          },
          {
            id: "m1.r2",
            label: "Satisfaction·UI",
            kind: "ordinal",
            options: [
              { id: "1", label: "Bad" },
              { id: "2", label: "Good" },
            ],
          },
        ],
        [row({ "m1.r1": 2, "m1.r2": 1 })],
      ),
    );
    const labels = wrapper.findAll(".matrix-row-label").map((node) => node.text());
    expect(labels).toEqual(["Speed", "UI"]);
    wrapper.unmount();
  });

  it("排序题呈现平均位次", async () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));
    const wrapper = await render(
      dataset(
        [
          { id: "rk.a", label: "Rank·UI", kind: "ordinal", options: options(2) },
          { id: "rk.b", label: "Rank·Speed", kind: "ordinal", options: options(2) },
        ],
        [row({ "rk.a": 1, "rk.b": 2 }), row({ "rk.a": 2, "rk.b": 1 })],
      ),
    );
    const badges = wrapper.findAll(".rank-badge").map((node) => node.text());
    expect(badges).toEqual(["1.5", "1.5"]);
    wrapper.unmount();
  });
});
