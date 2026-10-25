// 逐题摘要的纯客户端聚合（issue #217）：输入是数据段已加载的当前版本数据集
// （SurveyDataset，见 ./dataset.js），不新增 API、不依赖 chart-engine。展开变量
// 口径与变量字典/CSV 同源（surveys 包 core 的 surveyVariables）：变量 id 要么是
// 题目 id（单变量题），要么是 `${questionId}.${子 id}`（矩阵/排序/多项填空/矩阵
// 填空）——questionId 与子 id 都过 idSchema（无点号），按第一个点切分无歧义。
// 判型口径（M1）：数据集自带该发布定义的 questionTypes 映射时按真实题型呈现；
// 映射缺失（异常/旧数据）才回落按变量形状推断，回落卡带 inferred 角标。
import type { SurveyQuestionType } from "../../contracts/index.js";
import type {
  SurveyDataset,
  SurveyDatasetRow,
  SurveyDatasetValue,
  SurveyDatasetVariable,
} from "./dataset.js";

export interface SummaryBucket {
  id: string;
  label: string;
  count: number;
}

export interface TextEntry {
  text: string;
  count: number;
}

export interface ChoiceSummary {
  view: "choice";
  title: string;
  /** 多选的占比按作答人数计（可超 100%），呈现层据此换文案。 */
  multi: boolean;
  options: SummaryBucket[];
  answered: number;
  unanswered: number;
}

export interface OrdinalSummary {
  view: "ordinal";
  title: string;
  buckets: SummaryBucket[];
  /** 档位 id 全为数字时给出均值，否则 null。 */
  mean: number | null;
  answered: number;
  unanswered: number;
}

export interface NpsSummary {
  view: "nps";
  title: string;
  buckets: SummaryBucket[];
  detractors: number;
  passives: number;
  promoters: number;
  /** 净推荐值 =（推荐者% − 贬损者%），0–100 的一位小数。 */
  netPercent: number;
  answered: number;
  unanswered: number;
}

export interface NumberSummary {
  view: "number";
  title: string;
  min: number | null;
  max: number | null;
  mean: number | null;
  buckets: Array<{ label: string; count: number }>;
  answered: number;
  unanswered: number;
}

export interface TextSummary {
  view: "text";
  title: string;
  /** 按出现频次降序，同频按首次出现序。 */
  entries: TextEntry[];
  answered: number;
  unanswered: number;
}

export interface DateSummary {
  view: "date";
  title: string;
  entries: TextEntry[];
  answered: number;
  unanswered: number;
}

export interface RankingSummary {
  view: "ranking";
  title: string;
  /** 保持选项顺序；averageRank 是该选项的名次均值（1 = 最靠前）。 */
  items: Array<{ id: string; label: string; averageRank: number | null }>;
  answered: number;
  unanswered: number;
}

export interface MatrixRowSummary {
  id: string;
  label: string;
  summary: OrdinalSummary | ChoiceSummary | TextSummary;
}

export interface MatrixSummary {
  view: "matrix";
  title: string;
  rowView: "ordinal" | "multi" | "text";
  rows: MatrixRowSummary[];
  /** 至少答了一行的作答人数（基数按行各算，出现在行摘要里）。 */
  answered: number;
  unanswered: number;
}

type QuestionSummaryBase =
  | ChoiceSummary
  | OrdinalSummary
  | NpsSummary
  | NumberSummary
  | TextSummary
  | DateSummary
  | RankingSummary
  | MatrixSummary;

/** 每条摘要都带所属题目 id（组前缀）与判型来源：questionType 是发布定义里的
 *  真实题型（null = 定义不可得），inferred 为真时呈现层给「按变量形状推断」角标。 */
export type QuestionSummary = QuestionSummaryBase & {
  questionId: string;
  questionType: SurveyQuestionType | null;
  inferred: boolean;
};

const NUMBER_BUCKETS = 8;

type CellState = "answered" | "unanswered" | "hidden";

/** 单元格三态：未展示（跳分支）不算进任何基数；未回答含缺失与形状不符。 */
function cellState(
  row: SurveyDatasetRow,
  variableId: string,
  isValid: (value: SurveyDatasetValue) => boolean,
): CellState {
  if (row.missing[variableId] === "not_displayed") return "hidden";
  if (row.missing[variableId] === "unanswered") return "unanswered";
  const value = row.values[variableId];
  return value === undefined || !isValid(value) ? "unanswered" : "answered";
}

function questionIdOf(variableId: string): string {
  const at = variableId.indexOf(".");
  return at === -1 ? variableId : variableId.slice(0, at);
}

interface VariableGroup {
  questionId: string;
  variables: SurveyDatasetVariable[];
}

function groupVariables(variables: SurveyDatasetVariable[]): VariableGroup[] {
  const groups: VariableGroup[] = [];
  const index = new Map<string, VariableGroup>();
  for (const variable of variables) {
    const questionId = questionIdOf(variable.id);
    let group = index.get(questionId);
    if (!group) {
      group = { questionId, variables: [] };
      index.set(questionId, group);
      groups.push(group);
    }
    group.variables.push(variable);
  }
  return groups;
}

function commonLabelPrefix(labels: string[]): string {
  let prefix = labels[0] ?? "";
  for (const label of labels.slice(1)) {
    let at = 0;
    while (at < prefix.length && at < label.length && prefix[at] === label[at])
      at += 1;
    prefix = prefix.slice(0, at);
    if (!prefix) break;
  }
  return prefix;
}

/** 组标题 = 组内变量标签的最长公共前缀在最后一个「·」处截断；单变量组即原标签。 */
function groupTitle(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  const common = commonLabelPrefix(labels);
  const at = common.lastIndexOf("·");
  if (at > 0) return common.slice(0, at);
  return labels[0]!;
}

function subLabel(label: string, title: string): string {
  const prefix = `${title}·`;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

function bucketLabel(from: number, to: number): string {
  const trim = (n: number) =>
    Number(n.toFixed(2)).toLocaleString("en-US", { useGrouping: false });
  return from === to ? trim(from) : `${trim(from)} – ${trim(to)}`;
}

const isText = (value: SurveyDatasetValue): boolean =>
  typeof value === "string" && value.trim().length > 0;
const isDate = (value: SurveyDatasetValue): boolean =>
  typeof value === "string" && value.length > 0;
const isNumber = (value: SurveyDatasetValue): boolean =>
  typeof value === "number" && Number.isFinite(value);

function choiceCounts(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  multi: boolean,
): ChoiceSummary {
  const isValid = multi
    ? (value: SurveyDatasetValue): boolean =>
        Array.isArray(value) && value.some((v) => typeof v === "string")
    : (value: SurveyDatasetValue): boolean => typeof value === "string";
  const counts = new Map<string, number>();
  let answered = 0;
  let unanswered = 0;
  for (const row of rows) {
    const state = cellState(row, variable.id, isValid);
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    answered += 1;
    const value = row.values[variable.id];
    const picked = Array.isArray(value) ? value : [value];
    for (const entry of picked) {
      if (typeof entry !== "string") continue;
      counts.set(entry, (counts.get(entry) ?? 0) + 1);
    }
  }
  return {
    view: "choice",
    title: variable.label,
    multi,
    options: (variable.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      count: counts.get(option.id) ?? 0,
    })),
    answered,
    unanswered,
  };
}

function ordinalCounts(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  title: string,
): OrdinalSummary {
  const counts = new Map<string, number>();
  let answered = 0;
  let unanswered = 0;
  let sum = 0;
  let numeric = true;
  for (const row of rows) {
    const state = cellState(row, variable.id, (value) =>
      isNumber(value),
    );
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    answered += 1;
    const value = row.values[variable.id] as number;
    sum += value;
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = (variable.options ?? []).map((option) => {
    if (!/^-?\d+$/.test(option.id)) numeric = false;
    return {
      id: option.id,
      label: option.label,
      count: counts.get(option.id) ?? 0,
    };
  });
  return {
    view: "ordinal",
    title,
    buckets,
    mean: numeric && answered ? sum / answered : null,
    answered,
    unanswered,
  };
}

/** 回落 NPS 判定：只看变量自身形状（0–10 共 11 档的有序变量）。仅在发布定义
 *  不可得时用于兜底——0–10 的量表题会同形，真实口径走 questionTypes。 */
function isNpsShape(variable: SurveyDatasetVariable): boolean {
  const options = variable.options ?? [];
  return options.length === 11 && options.every((o, i) => o.id === String(i));
}

function npsSummary(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  title: string,
): NpsSummary {
  const base = ordinalCounts(rows, variable, title);
  const countOf = (from: number, to: number) =>
    base.buckets
      .filter((bucket) => {
        const id = Number(bucket.id);
        return id >= from && id <= to;
      })
      .reduce((total, bucket) => total + bucket.count, 0);
  const detractors = countOf(0, 6);
  const passives = countOf(7, 8);
  const promoters = countOf(9, 10);
  return {
    view: "nps",
    title,
    buckets: base.buckets,
    detractors,
    passives,
    promoters,
    netPercent: base.answered
      ? Number((((promoters - detractors) / base.answered) * 100).toFixed(1))
      : 0,
    answered: base.answered,
    unanswered: base.unanswered,
  };
}

function numberSummary(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  title: string,
): NumberSummary {
  const values: number[] = [];
  let unanswered = 0;
  for (const row of rows) {
    const state = cellState(row, variable.id, isNumber);
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    values.push(row.values[variable.id] as number);
  }
  if (!values.length)
    return {
      view: "number",
      title,
      min: null,
      max: null,
      mean: null,
      buckets: [],
      answered: 0,
      unanswered,
    };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((total, v) => total + v, 0) / values.length;
  const buckets: Array<{ label: string; count: number }> = [];
  if (min === max) {
    buckets.push({
      label: bucketLabel(min, max),
      count: values.length,
    });
  } else {
    const width = (max - min) / NUMBER_BUCKETS;
    const edges = Array.from(
      { length: NUMBER_BUCKETS },
      (_, i) => min + i * width,
    );
    for (let i = 0; i < NUMBER_BUCKETS; i += 1)
      buckets.push({
        label: bucketLabel(
          edges[i]!,
          i === NUMBER_BUCKETS - 1 ? max : edges[i + 1]!,
        ),
        count: 0,
      });
    for (const value of values) {
      // 自顶向下找第一个下沿 ≤ 值的桶；末桶右闭，浮点边界不再靠除法取整。
      let at = NUMBER_BUCKETS - 1;
      while (at > 0 && value < edges[at]!) at -= 1;
      buckets[at]!.count += 1;
    }
  }
  return {
    view: "number",
    title,
    min,
    max,
    mean,
    buckets,
    answered: values.length,
    unanswered,
  };
}

function textEntries(values: string[]): TextEntry[] {
  const counts = new Map<string, number>();
  for (const value of values)
    counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts, ([text, count]) => ({ text, count })).sort(
    (a, b) => b.count - a.count,
  );
}

function textSummary(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  title: string,
): TextSummary {
  const values: string[] = [];
  let unanswered = 0;
  for (const row of rows) {
    const state = cellState(row, variable.id, isText);
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    values.push(row.values[variable.id] as string);
  }
  return {
    view: "text",
    title,
    entries: textEntries(values),
    answered: values.length,
    unanswered,
  };
}

function dateSummary(
  rows: SurveyDatasetRow[],
  variable: SurveyDatasetVariable,
  title: string,
): DateSummary {
  const values: string[] = [];
  let unanswered = 0;
  for (const row of rows) {
    const state = cellState(row, variable.id, isDate);
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    values.push(row.values[variable.id] as string);
  }
  return {
    view: "date",
    title,
    entries: textEntries(values),
    answered: values.length,
    unanswered,
  };
}

/** 回落排序题判定：组内 ≥2 个有序变量，档位恰好是 1..组大小且档位标签是数字。
 *  矩阵单选的档位 id 同样是位次（1..列数），靠「标签 = 数字位次」区分——列
 *  文案是自由文本，只有真排序题的档位标签才是 spanOptions 生成的数字串。 */
function isRankingGroup(group: VariableGroup): boolean {
  const size = group.variables.length;
  if (size < 2) return false;
  return group.variables.every(
    (variable) =>
      (variable.options ?? []).length === size &&
      variable.options!.every(
        (option, i) => option.id === String(i + 1) && option.label === option.id,
      ),
  );
}

function rankingSummary(
  rows: SurveyDatasetRow[],
  group: VariableGroup,
  title: string,
): RankingSummary {
  const first = group.variables[0]!;
  let answered = 0;
  let unanswered = 0;
  const rankSums = group.variables.map(() => 0);
  const rankCounts = group.variables.map(() => 0);
  for (const row of rows) {
    const state = cellState(row, first.id, isNumber);
    if (state === "hidden") continue;
    if (state === "unanswered") {
      unanswered += 1;
      continue;
    }
    answered += 1;
    group.variables.forEach((variable, index) => {
      const value = row.values[variable.id];
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      rankSums[index] += value;
      rankCounts[index] += 1;
    });
  }
  return {
    view: "ranking",
    title,
    items: group.variables.map((variable, index) => ({
      id: variable.id,
      label: subLabel(variable.label, title),
      averageRank: rankCounts[index]
        ? rankSums[index]! / rankCounts[index]!
        : null,
    })),
    answered,
    unanswered,
  };
}

function matrixSummary(
  rows: SurveyDatasetRow[],
  group: VariableGroup,
  title: string,
): MatrixSummary {
  const firstKind = group.variables[0]!.kind;
  const rowView =
    firstKind === "multiple"
      ? "multi"
      : firstKind === "text"
        ? "text"
        : "ordinal";
  let answered = 0;
  let unanswered = 0;
  const states = rows.map((row) =>
    group.variables.map((variable) =>
      cellState(
        row,
        variable.id,
        variable.kind === "multiple"
          ? (value) => Array.isArray(value) && value.length > 0
          : variable.kind === "text"
            ? isText
            : isNumber,
      ),
    ),
  );
  for (const rowStates of states) {
    if (rowStates.every((state) => state === "hidden")) continue;
    if (rowStates.some((state) => state === "answered")) answered += 1;
    else unanswered += 1;
  }
  return {
    view: "matrix",
    title,
    rowView,
    answered,
    unanswered,
    rows: group.variables.map((variable, index) => ({
      id: variable.id,
      label: subLabel(variable.label, title),
      summary:
        variable.kind === "multiple"
          ? choiceCounts(rows, variable, true)
          : variable.kind === "text"
            ? textSummary(rows, variable, subLabel(variable.label, title))
            : ordinalCounts(rows, variable, subLabel(variable.label, title)),
    })),
  };
}

/** 回落判型（questionTypes 缺失/该题缺映射时）：按变量形状猜呈现。代价是
 *  0–10 量表会同形 NPS、数字位次组会同形排序——所以这只是异常数据的兜底。 */
function shapeSummary(
  group: VariableGroup,
  rows: SurveyDatasetRow[],
  title: string,
): QuestionSummaryBase {
  const first = group.variables[0]!;
  switch (first.kind) {
    case "categorical":
      return choiceCounts(rows, first, false);
    case "multiple":
      return group.variables.length > 1
        ? matrixSummary(rows, group, title)
        : choiceCounts(rows, first, true);
    case "text":
      return group.variables.length > 1
        ? matrixSummary(rows, group, title)
        : textSummary(rows, first, title);
    case "number":
      return numberSummary(rows, first, title);
    case "date":
      return dateSummary(rows, first, title);
    case "ordinal":
      if (group.variables.length > 1)
        return isRankingGroup(group)
          ? rankingSummary(rows, group, title)
          : matrixSummary(rows, group, title);
      return isNpsShape(first)
        ? npsSummary(rows, first, title)
        : ordinalCounts(rows, first, title);
  }
}

/** 权威判型：变量组 ↔ 发布定义题目（含矩阵行）精确映射，按真实题型出视图。
 *  statement 不产生变量，调用方已排除。 */
function typedSummary(
  type: Exclude<SurveyQuestionType, "statement">,
  group: VariableGroup,
  rows: SurveyDatasetRow[],
  title: string,
): QuestionSummaryBase {
  const first = group.variables[0]!;
  switch (type) {
    case "single":
    case "dropdown":
    case "image_single":
      return choiceCounts(rows, first, false);
    case "multiple":
    case "image_multiple":
      return choiceCounts(rows, first, true);
    case "ranking":
      return rankingSummary(rows, group, title);
    case "text":
    case "time":
      return textSummary(rows, first, title);
    case "number":
      return numberSummary(rows, first, title);
    case "scale":
    case "rating":
      return ordinalCounts(rows, first, title);
    case "nps":
      return npsSummary(rows, first, title);
    case "date":
      return dateSummary(rows, first, title);
    case "matrix_single":
    case "matrix_multiple":
    case "multi_text":
    case "matrix_text":
      return matrixSummary(rows, group, title);
  }
}

/** 数据集 → 按题目分组的逐题摘要（保持定义顺序；说明块不产生变量，自然不出现）。 */
export function summarizeDataset(dataset: SurveyDataset): QuestionSummary[] {
  const types = dataset.questionTypes;
  return groupVariables(dataset.variables).map((group) => {
    const title = groupTitle(group.variables.map((v) => v.label));
    const type = types?.[group.questionId] ?? null;
    const base =
      type && type !== "statement"
        ? typedSummary(type, group, dataset.rows, title)
        : shapeSummary(group, dataset.rows, title);
    return {
      ...base,
      questionId: group.questionId,
      questionType: type,
      inferred: !(type && type !== "statement"),
    };
  });
}
