import { describe, expect, it } from "vitest";
import { describeResearchTable } from "./report-narrative.js";
import type { SurveyResearchTable } from "../contracts/index.js";
function table(id: string, rows: SurveyResearchTable["rows"]): SurveyResearchTable {
  return { id, title: id, columns: [], rows };
}
describe("固定结果的学术解读", () => {
  it("区分跨零、正向和负向区间，不把统计关联写成因果", () => {
    const texts = describeResearchTable(table("coefficients", [
      { term: "低水平", estimate: -.12, ciLow: -.2, ciHigh: -.03 },
      { term: "中水平", estimate: .04, ciLow: -.02, ciHigh: .1 },
      { term: "高水平", estimate: .15, ciLow: .04, ciHigh: .3 },
    ]));
    expect(texts[0]).toContain("负向统计关联");
    expect(texts[1]).toContain("区间包含零");
    expect(texts[2]).toContain("正向统计关联");
    expect(texts.every(text => text.includes("不等于因果证据"))).toBe(true);
  });
  it("条件效应区分点估计趋势与差异检验，不把递增趋势直接写成调节成立", () => {
    const texts = describeResearchTable(table("conditional_indirect", [
      { effect: "W=-1 条件间接效应", estimate: .1 },
      { effect: "W=0 条件间接效应", estimate: .2 },
      { effect: "W=+1 条件间接效应", estimate: .3 },
      { effect: "高低条件差", estimate: .2, ciLow: -.1, ciHigh: .5 },
    ]));
    expect(texts[0]).toContain("递增");
    expect(texts[1]).toContain("区间包含零");
    expect(texts[1]).toContain("bootstrap");
  });
  it("缺失和非有限区间不编出结论，边界零仍视为包含零", () => {
    const texts = describeResearchTable(table("coefficients", [
      { term: "Intercept", estimate: 1, ciLow: .5, ciHigh: 2 },
      { term: "X", estimate: .1, ciLow: 0, ciHigh: .2 },
      { term: "Y", estimate: null, ciLow: null, ciHigh: null },
      { term: "Z", estimate: Infinity, ciLow: 0, ciHigh: 1 },
    ]));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("区间包含零");
  });
  it("负 alpha 指向计分和条目核对，缺失 alpha 不评价信度", () => {
    const texts = describeResearchTable(table("reliability", [
      { construct: "A", items: 3, n: 20, rawAlpha: -.2 },
      { construct: "B", items: 3, n: 20, rawAlpha: null },
    ]));
    expect(texts[0]).toContain("反向计分");
    expect(texts[1]).toContain("无法估计");
  });
  it("EFA 累计比例只使用实际提取方差，未知表不编摘要", () => {
    expect(describeResearchTable(table("efa_variance", [{ factor: 1, varianceExplained: .3 }, { factor: 2, varianceExplained: .2 }]))[0]).toContain("50.0%");
    expect(describeResearchTable(table("other", [{ value: 3 }]))).toEqual([]);
  });
});
