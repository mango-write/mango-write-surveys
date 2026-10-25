import {
  EigenvalueDecomposition,
  Matrix,
  SingularValueDecomposition,
  inverse,
} from "ml-matrix";

import { SurveyError } from "../server/errors.js";

export interface NumericVariable {
  id: string;
  label: string;
  values: Array<number | null>;
}

export interface CompleteMatrix {
  columns: string[];
  labels: string[];
  values: number[][];
  rowIndices: number[];
  missingRows: number;
}

export function completeCases(
  variables: NumericVariable[],
  rowCount: number,
): CompleteMatrix {
  const values: number[][] = [];
  const rowIndices: number[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const candidate = variables.map((variable) => variable.values[row]);
    if (candidate.every((value): value is number => typeof value === "number")) {
      values.push(candidate as number[]);
      rowIndices.push(row);
    }
  }
  return {
    columns: variables.map((variable) => variable.id),
    labels: variables.map((variable) => variable.label),
    values,
    rowIndices,
    missingRows: rowCount - values.length,
  };
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleVariance(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function standardize(values: number[]): number[] {
  const average = mean(values);
  const sd = Math.sqrt(sampleVariance(values));
  if (!Number.isFinite(sd) || sd === 0)
    throw new SurveyError("analysis_failed", 422, "标准化变量必须有非零样本方差");
  return values.map((value) => (value - average) / sd);
}

export function cronbachAlpha(values: number[][]): number {
  const n = values.length;
  const k = values[0]?.length ?? 0;
  if (n < 2 || k < 2)
    throw new SurveyError("analysis_failed", 422, "信度分析至少需要 2 行和 2 个题目");
  const itemVariances = Array.from({ length: k }, (_, column) =>
    sampleVariance(values.map((row) => row[column]!)),
  );
  const totals = values.map((row) => row.reduce((sum, value) => sum + value, 0));
  return (k / (k - 1)) * (1 - itemVariances.reduce((a, b) => a + b, 0) / sampleVariance(totals));
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.99999999999980993;
  const z = value - 1;
  coefficients.forEach((coefficient, index) => {
    x += coefficient / (z + index + 1);
  });
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 300;
  const epsilon = 3e-14;
  const fpMin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function studentTCdf(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  const x = df / (df + t * t);
  const tail = 0.5 * regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

export function studentTQuantile(p: number, df: number): number {
  let low = -100;
  let high = 100;
  for (let i = 0; i < 120; i += 1) {
    const mid = (low + high) / 2;
    if (studentTCdf(mid, df) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function lowerRegularizedGamma(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    let sum = 1 / s;
    let term = sum;
    for (let n = 1; n < 500; n += 1) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  let b = x + 1 - s;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

export function chiSquareSurvival(x: number, df: number): number {
  return 1 - lowerRegularizedGamma(df / 2, x / 2);
}

export function correlationMatrix(values: number[][]): Matrix {
  const standardized = Array.from({ length: values[0]!.length }, (_, column) =>
    standardize(values.map((row) => row[column]!)),
  );
  const result = Matrix.zeros(standardized.length, standardized.length);
  for (let i = 0; i < standardized.length; i += 1)
    for (let j = 0; j < standardized.length; j += 1)
      result.set(
        i,
        j,
        standardized[i]!.reduce((sum, value, row) => sum + value * standardized[j]![row]!, 0) /
          (values.length - 1),
      );
  return result;
}

function safeInverse(matrix: Matrix): Matrix {
  try {
    return inverse(matrix);
  } catch {
    throw new SurveyError("analysis_failed", 422, "模型矩阵奇异，请移除完全共线变量");
  }
}

export interface OlsTerm {
  term: string;
  estimate: number;
  stdError: number;
  statistic: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
}

export interface OlsResult {
  terms: OlsTerm[];
  covariance: number[][];
  coefficients: number[];
  n: number;
  dfResidual: number;
  r2: number;
  adjustedR2: number;
  cohenF2: number;
  maxVif: number | null;
}

export function fitOlsPoint(predictors: number[][], outcome: number[]): number[] {
  if (outcome.length !== predictors.length || outcome.length <= (predictors[0]?.length ?? 0) + 1)
    throw new SurveyError("analysis_failed", 422, "Bootstrap 重抽样无法估计模型");
  const x = new Matrix(predictors.map((row) => [1, ...row]));
  const xt = x.transpose();
  return safeInverse(xt.mmul(x)).mmul(xt).mmul(Matrix.columnVector(outcome)).to1DArray();
}

export function fitOlsHc3(
  predictors: number[][],
  outcome: number[],
  names: string[],
): OlsResult {
  const n = outcome.length;
  const p = predictors[0]?.length ?? 0;
  if (n <= p + 1 || predictors.length !== n)
    throw new SurveyError("analysis_failed", 422, "有效样本量不足以估计该模型");
  const x = new Matrix(predictors.map((row) => [1, ...row]));
  const y = Matrix.columnVector(outcome);
  const xt = x.transpose();
  const xtxInverse = safeInverse(xt.mmul(x));
  const coefficients = xtxInverse.mmul(xt).mmul(y).to1DArray();
  const fitted = x.mmul(Matrix.columnVector(coefficients)).to1DArray();
  const residuals = outcome.map((value, index) => value - fitted[index]!);
  const hat = Array.from({ length: n }, (_, row) => {
    const vector = x.getRowVector(row);
    return vector.mmul(xtxInverse).mmul(vector.transpose()).get(0, 0);
  });
  const meat = Matrix.zeros(p + 1, p + 1);
  for (let row = 0; row < n; row += 1) {
    if (hat[row]! >= 1)
      throw new SurveyError("analysis_failed", 422, "HC3 无法处理杠杆值为 1 的观测");
    const weight = (residuals[row]! / (1 - hat[row]!)) ** 2;
    for (let i = 0; i <= p; i += 1)
      for (let j = 0; j <= p; j += 1)
        meat.set(i, j, meat.get(i, j) + weight * x.get(row, i) * x.get(row, j));
  }
  const covarianceMatrix = xtxInverse.mmul(meat).mmul(xtxInverse);
  const dfResidual = n - p - 1;
  const critical = studentTQuantile(0.975, dfResidual);
  const centeredMean = mean(outcome);
  const sse = residuals.reduce((sum, value) => sum + value * value, 0);
  const sst = outcome.reduce((sum, value) => sum + (value - centeredMean) ** 2, 0);
  const r2 = 1 - sse / sst;
  const covariance = covarianceMatrix.to2DArray();
  const termNames = ["(Intercept)", ...names];
  const terms = coefficients.map((estimate, index) => {
    const stdError = Math.sqrt(Math.max(0, covariance[index]![index]!));
    const statistic = estimate / stdError;
    return {
      term: termNames[index]!,
      estimate,
      stdError,
      statistic,
      pValue: 2 * (1 - studentTCdf(Math.abs(statistic), dfResidual)),
      ciLow: estimate - critical * stdError,
      ciHigh: estimate + critical * stdError,
    };
  });
  let maxVif: number | null = null;
  if (p > 1) {
    const predictorCorrelation = correlationMatrix(predictors);
    const correlationInverse = safeInverse(predictorCorrelation);
    maxVif = Math.max(...Array.from({ length: p }, (_, i) => correlationInverse.get(i, i)));
  } else maxVif = 1;
  return {
    terms,
    covariance,
    coefficients,
    n,
    dfResidual,
    r2,
    adjustedR2: 1 - ((1 - r2) * (n - 1)) / dfResidual,
    cohenF2: r2 / (1 - r2),
    maxVif,
  };
}

function varimax(loadings: Matrix): Matrix {
  const p = loadings.rows;
  const factors = loadings.columns;
  let rotated = loadings.clone();
  let previous = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const lambda = rotated.clone();
    for (let i = 0; i < p; i += 1) {
      const h2 = Math.sqrt(
        Array.from({ length: factors }, (_, j) => lambda.get(i, j) ** 2).reduce((a, b) => a + b, 0),
      );
      if (h2 > 1e-12)
        for (let j = 0; j < factors; j += 1) lambda.set(i, j, lambda.get(i, j) / h2);
    }
    const squared = lambda.clone();
    for (let i = 0; i < p; i += 1)
      for (let j = 0; j < factors; j += 1) squared.set(i, j, lambda.get(i, j) ** 3);
    const columnMeans = Array.from({ length: factors }, (_, j) =>
      mean(Array.from({ length: p }, (_, i) => lambda.get(i, j) ** 2)),
    );
    const centered = lambda.clone();
    for (let i = 0; i < p; i += 1)
      for (let j = 0; j < factors; j += 1)
        centered.set(i, j, lambda.get(i, j) * columnMeans[j]! / p);
    const b = lambda.transpose().mmul(squared.sub(centered));
    const svd = new SingularValueDecomposition(b, { autoTranspose: true });
    rotated = lambda.mmul(svd.leftSingularVectors.mmul(svd.rightSingularVectors.transpose()));
    const objective = svd.diagonal.reduce((a, b) => a + b, 0);
    if (previous !== 0 && objective < previous * (1 + 1e-10)) break;
    previous = objective;
  }
  return rotated;
}

export interface EfaResult {
  kmo: number;
  bartlettChiSquare: number;
  bartlettDf: number;
  bartlettPValue: number;
  loadings: number[][];
  communalities: number[];
  varianceExplained: number[];
}

export function principalAxisEfa(values: number[][], factorCount: number): EfaResult {
  const n = values.length;
  const p = values[0]?.length ?? 0;
  if (factorCount < 1 || factorCount >= p || n <= p)
    throw new SurveyError("analysis_failed", 422, "EFA 要求因子数小于题目数且有效 n 大于题目数");
  const correlation = correlationMatrix(values);
  const correlationInverse = safeInverse(correlation);
  const partial = correlation.clone();
  for (let i = 0; i < p; i += 1)
    for (let j = 0; j < p; j += 1)
      partial.set(i, j, -correlationInverse.get(i, j) / Math.sqrt(correlationInverse.get(i, i) * correlationInverse.get(j, j)));
  let r2 = 0;
  let partial2 = 0;
  for (let i = 0; i < p; i += 1)
    for (let j = 0; j < p; j += 1)
      if (i !== j) {
        r2 += correlation.get(i, j) ** 2;
        partial2 += partial.get(i, j) ** 2;
      }
  const kmo = r2 / (r2 + partial2);
  let determinant = 1;
  const eigenForDet = new EigenvalueDecomposition(correlation, { assumeSymmetric: true });
  for (const value of eigenForDet.realEigenvalues) determinant *= Math.max(value, 1e-12);
  const bartlettChiSquare = -(n - 1 - (2 * p + 5) / 6) * Math.log(determinant);
  const bartlettDf = (p * (p - 1)) / 2;
  let communalities = Array.from({ length: p }, (_, i) => Math.min(0.99, Math.max(0.05, 1 - 1 / correlationInverse.get(i, i))));
  let loadings = Matrix.zeros(p, factorCount);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const reduced = correlation.clone();
    communalities.forEach((value, index) => reduced.set(index, index, value));
    const eigen = new EigenvalueDecomposition(reduced, { assumeSymmetric: true });
    const order = eigen.realEigenvalues.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
    loadings = Matrix.zeros(p, factorCount);
    order.slice(0, factorCount).forEach(({ value, index }, factor) => {
      const scale = Math.sqrt(Math.max(0, value));
      for (let row = 0; row < p; row += 1)
        loadings.set(row, factor, eigen.eigenvectorMatrix.get(row, index) * scale);
    });
    const next = Array.from({ length: p }, (_, row) =>
      Math.min(1, Math.max(0, Array.from({ length: factorCount }, (_, factor) => loadings.get(row, factor) ** 2).reduce((a, b) => a + b, 0))),
    );
    const change = Math.max(...next.map((value, index) => Math.abs(value - communalities[index]!)));
    communalities = next;
    if (change < 1e-9) break;
  }
  const varianceExplained = Array.from({ length: factorCount }, (_, factor) =>
    Array.from({ length: p }, (_, row) => loadings.get(row, factor) ** 2).reduce((a, b) => a + b, 0) / p,
  );
  if (factorCount > 1) loadings = varimax(loadings);
  return {
    kmo,
    bartlettChiSquare,
    bartlettDf,
    bartlettPValue: chiSquareSurvival(bartlettChiSquare, bartlettDf),
    loadings: loadings.to2DArray(),
    communalities,
    varianceExplained,
  };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleStandardDeviation(values: number[]): number {
  return Math.sqrt(sampleVariance(values));
}

export function percentile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower]! + fraction * (sorted[lower + 1]! - sorted[lower]! || 0);
}
