import { describe, expect, it } from "vitest";

import {
  chiSquareSurvival,
  createSeededRandom,
  cronbachAlpha,
  fitOlsHc3,
  percentile,
  principalAxisEfa,
  studentTCdf,
} from "./statistics.js";

describe("research statistics independent references", () => {
  it("matches raw alpha reference 0.828125", () => {
    expect(cronbachAlpha([
      [1, 2, 3], [2, 1, 4], [3, 4, 2], [4, 3, 6], [5, 7, 5], [6, 5, 9],
    ])).toBeCloseTo(0.828125, 12);
  });

  it("matches NumPy/SciPy OLS and HC3 reference values", () => {
    const predictors = [
      [0, 1], [1, 0], [2, 3], [3, 2], [4, 7],
      [5, 5], [6, 8], [8, 9], [9, 12], [10, 11],
    ];
    const outcome = [1.2, 2.1, 2.8, 4.4, 5.1, 6.8, 7.5, 9.2, 10.1, 12.4];
    const model = fitOlsHc3(predictors, outcome, ["x1", "x2"]);
    // 参考值经有理数精确解与独立 HC3 重算核对：系数 = [40006/38495,
    // 96509/76990, -5948/38495]，实现与之相差 ~1e-14。此前存放的「numpy 参考」
    // 带 ~1e-9 数值路径噪声且 maxVif 记错（1.0059，实为 1/(1-r²)=11.0826，
    // corr(x1,x2)=0.95381776），按核对结果改正而不是放宽容度迁就。
    expect(model.coefficients).toEqual(expect.arrayContaining([
      expect.closeTo(1.039251850889726, 10),
      expect.closeTo(1.2535264320041564, 10),
      expect.closeTo(-0.15451357319132356, 10),
    ]));
    expect(model.terms.map((term) => term.stdError)).toEqual([
      expect.closeTo(0.23919032017262823, 10),
      expect.closeTo(0.15222100611706962, 10),
      expect.closeTo(0.10052588335032435, 10),
    ]);
    expect(model.terms[1]!.pValue).toBeCloseTo(0.00007573532300719776, 12);
    expect(model.terms[1]!.ciLow).toBeCloseTo(0.8935809493379061, 10);
    expect(model.terms[1]!.ciHigh).toBeCloseTo(1.6134719146704368, 10);
    expect(model.r2).toBeCloseTo(0.9919973136725715, 12);
    expect(model.adjustedR2).toBeCloseTo(0.9897108318647347, 12);
    expect(model.cohenF2).toBeCloseTo(123.9580402236418, 9);
    expect(model.maxVif).toBeCloseTo(11.082582153526387, 10);
  });

  it("matches distribution references and deterministic bootstrap primitives", () => {
    expect(studentTCdf(2.5, 12)).toBeCloseTo(0.9860423002143374, 12);
    expect(chiSquareSurvival(7.2, 3)).toBeCloseTo(0.06578905268507095, 12);
    expect(percentile([0, 1, 2, 3], 0.25)).toBe(0.75);
    const first = createSeededRandom(20260902);
    const second = createSeededRandom(20260902);
    expect(Array.from({ length: 20 }, first)).toEqual(Array.from({ length: 20 }, second));
  });

  it("recovers closed-form principal-axis loadings for an equicorrelated matrix", () => {
    const hadamard = [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, -1, 1, -1, 1, -1, 1, -1],
      [1, 1, -1, -1, 1, 1, -1, -1],
      [1, -1, -1, 1, 1, -1, -1, 1],
      [1, 1, 1, 1, -1, -1, -1, -1],
      [1, -1, 1, -1, -1, 1, -1, 1],
      [1, 1, -1, -1, -1, -1, 1, 1],
      [1, -1, -1, 1, -1, 1, 1, -1],
    ];
    const values = hadamard.map((row) => [1, 2, 3].map((offset) =>
      (row[1]! + row[offset + 1]!) / Math.sqrt(2),
    ));
    const result = principalAxisEfa(values, 1);
    // 等相关 r=0.5 的三题闭式解：KMO = Σr²/(Σr²+Σ偏相关²) = 0.75/(0.75+1/3) = 9/13
    // （独立 numpy 值 0.6923076923076922；0.9 是错误期望）。
    expect(result.kmo).toBeCloseTo(0.6923076923076922, 10);
    expect(result.bartlettChiSquare).toBeCloseTo(-(7 - 11 / 6) * Math.log(0.5), 10);
    expect(result.bartlettDf).toBe(3);
    expect(result.communalities).toEqual([
      expect.closeTo(0.5, 8), expect.closeTo(0.5, 8), expect.closeTo(0.5, 8),
    ]);
    expect(result.loadings.map((row) => Math.abs(row[0]!))).toEqual([
      expect.closeTo(Math.sqrt(0.5), 8),
      expect.closeTo(Math.sqrt(0.5), 8),
      expect.closeTo(Math.sqrt(0.5), 8),
    ]);
    expect(result.varianceExplained).toEqual([expect.closeTo(0.5, 8)]);
  });
});
