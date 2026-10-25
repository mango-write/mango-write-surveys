import { describe, expect, it } from "vitest";
import { RESEARCH_TYPE_IDS } from "../index.js";
import { loadEvalDataset } from "./index.js";

// 评测集验收进测试：引用闭合、映射与变量字典一致在 loadEvalDataset 内
// 校验；这里的数量下限对应 issue #224 阶段 1 评测集的最低构成。
describe("评测集", () => {
  const dataset = loadEvalDataset();

  it("交叉校验零问题", () => {
    expect(dataset.issues).toEqual([]);
  });

  it("优秀案例覆盖全部研究类型", () => {
    expect(dataset.excellent.length).toBeGreaterThanOrEqual(RESEARCH_TYPE_IDS.length);
    const covered = new Set(dataset.excellent.map((c) => c.researchType));
    for (const id of RESEARCH_TYPE_IDS) {
      expect(covered.has(id), `${id} 缺优秀案例`).toBe(true);
    }
  });

  it("缺陷案例 ≥8 例、planted ≥12 条、覆盖 ≥5 维", () => {
    expect(dataset.defects.length).toBeGreaterThanOrEqual(8);
    const planted = dataset.defects.flatMap((c) => c.planted);
    expect(planted.length).toBeGreaterThanOrEqual(12);
    const dimensions = new Set(planted.map((p) => p.checkId.split(".")[0]));
    expect(dimensions.size).toBeGreaterThanOrEqual(5);
  });

  it("至少 1 例带 mustNotFlag 陷阱", () => {
    expect(dataset.defects.some((c) => (c.mustNotFlag ?? []).length > 0)).toBe(true);
  });

  it("边界情况 ≥5 例且三种判定都有", () => {
    expect(dataset.edge.length).toBeGreaterThanOrEqual(5);
    const verdicts = new Set(dataset.edge.map((c) => c.expected));
    for (const v of ["flag", "not_flag", "contextual"] as const) {
      expect(verdicts.has(v), `缺 ${v} 判定的边界案例`).toBe(true);
    }
  });

  it("新手任务 ≥3 且澄清项 ≥2", () => {
    expect(dataset.tasks.length).toBeGreaterThanOrEqual(3);
    for (const t of dataset.tasks) {
      expect(t.expectedClarifications.length).toBeGreaterThanOrEqual(2);
    }
  });
});
