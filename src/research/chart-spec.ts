// EChartsOption 等类型只从包根取：echarts 6 的 types/dist/echarts.d.ts 与
// shared.d.ts 对同名接口各有一份声明（zrender Animation 私有 _head 互斥），
// 与组件侧的 `from "echarts"` 混用会让 spec 赋值在结构比较上炸掉。
import type {
  DefaultLabelFormatterCallbackParams as CallbackDataParams,
  TooltipComponentFormatterCallbackParams as TopLevelFormatterParams,
  EChartsOption,
  CustomSeriesRenderItem,
} from "echarts";

import type {
  ResearchRunDetail,
  SurveyResearchTable,
} from "../contracts/index.js";

export type SurveyChartThemeId =
  | "screen"
  | "okabe-ito"
  | "cn-journal"
  | "journal-gray";
export type SurveyChartSurface = "auto" | "paper" | "dark" | "transparent";
export type SurveyChartFontScale = "sm" | "md" | "lg";

export interface SurveyChartViewStyle {
  theme: SurveyChartThemeId;
  surface: SurveyChartSurface;
  fontScale: SurveyChartFontScale;
  showGrid: boolean;
  showHeader: boolean;
}

export interface SurveyChartThemeTokens {
  id: SurveyChartThemeId;
  categoryColors: readonly string[];
  sequential: readonly [string, string, string];
  textColor: string;
  mutedColor: string;
  lineColor: string;
  fontFamily: string;
  barBorderRadius: number;
}

export const SURVEY_CHART_THEMES: Record<
  SurveyChartThemeId,
  SurveyChartThemeTokens
> = {
  screen: {
    id: "screen",
    categoryColors: [
      "#2F6FED",
      "#E66A2B",
      "#10B981",
      "#8B5CF6",
      "#F59E0B",
      "#06B6D4",
      "#EC4899",
      "#64748B",
    ],
    sequential: ["#2F6FED", "#F1F5F9", "#E66A2B"],
    textColor: "#1E293B",
    mutedColor: "#64748B",
    lineColor: "#E2E8F0",
    fontFamily:
      "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
    barBorderRadius: 4,
  },
  "okabe-ito": {
    id: "okabe-ito",
    categoryColors: [
      "#E69F00",
      "#56B4E9",
      "#009E73",
      "#F0E442",
      "#0072B2",
      "#D55E00",
      "#CC79A7",
      "#000000",
    ],
    sequential: ["#0072B2", "#F5F5F5", "#D55E00"],
    textColor: "#1A1A1A",
    mutedColor: "#525252",
    lineColor: "#D9D9D9",
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    barBorderRadius: 0,
  },
  "cn-journal": {
    id: "cn-journal",
    categoryColors: [
      "#3F5872",
      "#8C4A3F",
      "#5D7A4E",
      "#7A5D8C",
      "#B0863F",
      "#4E7A7A",
    ],
    sequential: ["#3F5872", "#F4F5F7", "#8C4A3F"],
    textColor: "#262626",
    mutedColor: "#595959",
    lineColor: "#D4D4D4",
    fontFamily: "'SimSun', 'Songti SC', serif",
    barBorderRadius: 0,
  },
  "journal-gray": {
    id: "journal-gray",
    categoryColors: [
      "#1A1A1A",
      "#4D4D4D",
      "#808080",
      "#B3B3B3",
      "#6E6E6E",
      "#999999",
    ],
    sequential: ["#D9D9D9", "#F5F5F5", "#1A1A1A"],
    textColor: "#1A1A1A",
    mutedColor: "#595959",
    lineColor: "#D9D9D9",
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    barBorderRadius: 0,
  },
};

export const DEFAULT_SURVEY_CHART_STYLE: SurveyChartViewStyle = {
  theme: "screen",
  surface: "auto",
  fontScale: "md",
  showGrid: true,
  showHeader: false,
};

export function createSurveyChartStyle(
  overrides: Partial<SurveyChartViewStyle> = {},
): SurveyChartViewStyle {
  return { ...DEFAULT_SURVEY_CHART_STYLE, ...overrides };
}

export const RESEARCH_CHART_COLORS = SURVEY_CHART_THEMES.screen.categoryColors;

export interface ResearchChartLabels {
  reliabilityTitle: string;
  reliabilityDescription: string;
  alphaAxis: string;
  efaVarianceTitle: string;
  efaVarianceDescription: string;
  varianceAxis: string;
  efaLoadingsTitle: string;
  efaLoadingsDescription: string;
  olsCoefficientsTitle: string;
  olsCoefficientsDescription: string;
  conditionalIndirectTitle: string;
  conditionalIndirectDescription: string;
  conditionalEffects: string[];
  simpleSlopesTitle: string;
  simpleSlopesDescription: string;
  estimateAxis: string;
  confidenceInterval: string;
  estimate: string;
}

export interface ResearchChartSpec {
  id:
    | "reliability-alpha"
    | "efa-variance"
    | "efa-loadings"
    | "ols-coefficients"
    | "conditional-indirect"
    | "simple-slopes"
    | "text-word-cloud";
  title: string;
  description: string;
  height: number;
  option: EChartsOption;
}

const defaultLabels: ResearchChartLabels = {
  reliabilityTitle: "各构念 Raw alpha",
  reliabilityDescription:
    "条形越长表示内部一致性系数越高；alpha 不证明单维性或结构效度。",
  alphaAxis: "Raw alpha",
  efaVarianceTitle: "各因子解释方差",
  efaVarianceDescription:
    "显示提取载荷平方和占题数的比例，不代替因子数的理论判断。",
  varianceAxis: "解释方差比例",
  efaLoadingsTitle: "因子载荷与共同度",
  efaLoadingsDescription:
    "颜色编码载荷方向与大小；共同度没有方向，应结合完整结果表核对。",
  olsCoefficientsTitle: "回归系数与 95% 置信区间",
  olsCoefficientsDescription:
    "点为非标准化系数，横线为 HC3 95% 置信区间；关联不等于因果。",
  conditionalIndirectTitle: "条件间接效应与 Bootstrap 95% CI",
  conditionalIndirectDescription:
    "点为效应估计，横线为 percentile Bootstrap 区间；不据此推断因果机制。",
  conditionalEffects: [
    "W=-1 条件间接效应",
    "W=0 条件间接效应",
    "W=+1 条件间接效应",
    "高低条件差",
    "调节中介指数 a×interaction",
  ],
  simpleSlopesTitle: "不同 W 水平下 M 的简单斜率",
  simpleSlopesDescription:
    "点为斜率估计，横线为 HC3 95% 置信区间；W 水平以标准差表示。",
  estimateAxis: "估计值",
  confidenceInterval: "95% CI",
  estimate: "估计",
};

interface ResolvedSurveyChartStyle {
  colors: readonly string[];
  sequential: readonly [string, string, string];
  textColor: string;
  mutedColor: string;
  lineColor: string;
  backgroundColor: string;
  fontFamily: string;
  fontSizePx: number;
  barBorderRadius: number;
  showGrid: boolean;
  showHeader: boolean;
}

const FONT_SCALE_PX: Record<SurveyChartFontScale, number> = {
  sm: 11,
  md: 12.5,
  lg: 14,
};

export function resolveSurveyChartTheme(
  style: Partial<SurveyChartViewStyle> = {},
  isDark = false,
): ResolvedSurveyChartStyle {
  const merged = createSurveyChartStyle(style);
  const tokens = SURVEY_CHART_THEMES[merged.theme];
  const effectiveSurface =
    merged.surface === "auto" ? (isDark ? "dark" : "paper") : merged.surface;
  const darkPalette =
    effectiveSurface === "dark" || (effectiveSurface === "transparent" && isDark);
  return {
    colors: tokens.categoryColors,
    sequential: tokens.sequential,
    textColor: darkPalette ? "#E5E7EB" : tokens.textColor,
    mutedColor: darkPalette ? "#9CA3AF" : tokens.mutedColor,
    lineColor: darkPalette ? "#2D323E" : tokens.lineColor,
    backgroundColor:
      effectiveSurface === "dark"
        ? "#181A20"
        : effectiveSurface === "transparent"
          ? "transparent"
          : "#FFFFFF",
    fontFamily: tokens.fontFamily,
    fontSizePx: FONT_SCALE_PX[merged.fontScale],
    barBorderRadius: tokens.barBorderRadius,
    showGrid: merged.showGrid,
    showHeader: merged.showHeader,
  };
}

const defaultResolvedStyle = resolveSurveyChartTheme();
const textColor = defaultResolvedStyle.textColor;
const mutedColor = defaultResolvedStyle.mutedColor;
const lineColor = defaultResolvedStyle.lineColor;

function tableById(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  id: string,
): SurveyResearchTable | null {
  return run.result.tables.find((table) => table.id === id) ?? null;
}

function finite(value: string | number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: string | number | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function decimal(value: number): string {
  return Number(value.toFixed(4)).toLocaleString("en-US", {
    useGrouping: false,
  });
}

function percent(value: number): string {
  return `${decimal(value * 100)}%`;
}

function tooltipParam(params: TopLevelFormatterParams): CallbackDataParams {
  return Array.isArray(params) ? params[0]! : params;
}

function numericTuple(params: CallbackDataParams): [number, number, number] {
  return params.value as [number, number, number];
}

function baseOption(): EChartsOption {
  return {
    animation: false,
    backgroundColor: "transparent",
    color: [...RESEARCH_CHART_COLORS],
    textStyle: {
      color: textColor,
      fontFamily: "system-ui, -apple-system, sans-serif",
    },
    aria: { enabled: true },
  };
}

function categoryAxis(data: string[], inverse = false) {
  return {
    type: "category" as const,
    data,
    inverse,
    axisLine: { lineStyle: { color: lineColor } },
    axisTick: { show: false },
    axisLabel: { color: textColor, width: 176, overflow: "truncate" as const },
  };
}

function valueAxis(name: string, percentValues = false) {
  return {
    type: "value" as const,
    name,
    nameTextStyle: { color: mutedColor },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: mutedColor,
      formatter: percentValues
        ? (value: number) => percent(value)
        : (value: number) => decimal(value),
    },
    splitLine: { lineStyle: { color: lineColor, type: "dashed" as const } },
  };
}

function reliabilitySpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "reliability");
  if (!table) return null;
  const rows = table.rows.flatMap((row) =>
    text(row.construct) && finite(row.rawAlpha)
      ? [{ name: row.construct, value: row.rawAlpha }]
      : [],
  );
  if (!rows.length) return null;
  const values = rows.map((row) => row.value);
  return {
    id: "reliability-alpha",
    title: labels.reliabilityTitle,
    description: labels.reliabilityDescription,
    height: Math.max(250, 104 + rows.length * 48),
    option: {
      ...baseOption(),
      grid: { left: "28%", right: 48, top: 40, bottom: 52 },
      xAxis: {
        ...valueAxis(labels.alphaAxis),
        nameLocation: "middle",
        nameGap: 32,
        min: Math.min(0, Math.floor(Math.min(...values) * 10) / 10),
        max: Math.max(1, Math.ceil(Math.max(...values) * 10) / 10),
      },
      yAxis: categoryAxis(
        rows.map((row) => row.name),
        true,
      ),
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: (params: TopLevelFormatterParams) => {
          const item = tooltipParam(params);
          return `${item.name}\n${labels.alphaAxis}: ${decimal(Number(item.value))}`;
        },
      },
      series: [
        {
          name: labels.alphaAxis,
          type: "bar",
          data: rows.map((row) => row.value),
          barMaxWidth: 24,
          itemStyle: { color: RESEARCH_CHART_COLORS[1], borderRadius: 3 },
          label: {
            show: true,
            position: "right",
            color: textColor,
            formatter: (params: CallbackDataParams) =>
              decimal(Number(params.value)),
          },
        },
      ],
    },
  };
}

function efaVarianceSpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "efa_variance");
  if (!table) return null;
  const rows = table.rows.flatMap((row) =>
    finite(row.varianceExplained)
      ? [{ name: String(row.factor ?? ""), value: row.varianceExplained }]
      : [],
  );
  if (!rows.length) return null;
  return {
    id: "efa-variance",
    title: labels.efaVarianceTitle,
    description: labels.efaVarianceDescription,
    height: 280,
    option: {
      ...baseOption(),
      grid: { left: 64, right: 28, top: 44, bottom: 52 },
      xAxis: {
        ...categoryAxis(rows.map((row) => row.name)),
        axisLabel: { color: textColor },
      },
      yAxis: { ...valueAxis(labels.varianceAxis, true), min: 0 },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: (params: TopLevelFormatterParams) => {
          const item = tooltipParam(params);
          return `${item.name}\n${labels.varianceAxis}: ${percent(Number(item.value))}`;
        },
      },
      series: [
        {
          type: "bar",
          data: rows.map((row) => row.value),
          barMaxWidth: 48,
          itemStyle: {
            color: RESEARCH_CHART_COLORS[0],
            borderRadius: [4, 4, 0, 0],
          },
          label: {
            show: true,
            position: "top",
            color: textColor,
            formatter: (params: CallbackDataParams) =>
              percent(Number(params.value)),
          },
        },
      ],
    },
  };
}

function efaLoadingsSpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "efa_loadings");
  if (!table) return null;
  const mapping = tableById(run, "variable_mapping");
  const variableLabels = new Map(
    (mapping?.rows ?? []).flatMap((row) =>
      text(row.variable) && text(row.label)
        ? [[row.variable, row.label] as const]
        : [],
    ),
  );
  const measureColumns = table.columns.filter(
    (column) => /^factor\d+$/.test(column.key) || column.key === "communality",
  );
  const variables = table.rows.flatMap((row) =>
    text(row.variable) ? [row.variable] : [],
  );
  const data = table.rows.flatMap((row, y) =>
    text(row.variable)
      ? measureColumns.flatMap((column, x) => {
          const value = row[column.key];
          return finite(value)
            ? [[x, y, value] as [number, number, number]]
            : [];
        })
      : [],
  );
  if (!variables.length || !measureColumns.length || !data.length) return null;
  return {
    id: "efa-loadings",
    title: labels.efaLoadingsTitle,
    description: labels.efaLoadingsDescription,
    height: Math.max(300, 152 + variables.length * 32),
    option: {
      ...baseOption(),
      grid: { left: "28%", right: 32, top: 32, bottom: 96 },
      xAxis: {
        ...categoryAxis(measureColumns.map((column) => column.label)),
        axisLabel: {
          color: textColor,
          interval: 0,
          rotate: variables.length > 8 ? 24 : 0,
        },
      },
      yAxis: categoryAxis(
        variables.map((variable) => variableLabels.get(variable) ?? variable),
        true,
      ),
      visualMap: {
        min: -1,
        max: 1,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        textStyle: { color: mutedColor },
        inRange: { color: ["#4C78A8", "#F4F0EA", "#D97745"] },
      },
      tooltip: {
        position: "top",
        renderMode: "richText",
        formatter: (params: TopLevelFormatterParams) => {
          const item = tooltipParam(params);
          const value = numericTuple(item);
          return `${variables[value[1]] ?? ""}\n${measureColumns[value[0]]?.label ?? ""}: ${decimal(value[2])}`;
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: true,
            color: textColor,
            formatter: (params: CallbackDataParams) =>
              decimal(numericTuple(params)[2]),
          },
          itemStyle: { borderColor: "#FFFFFF", borderWidth: 2 },
          emphasis: { itemStyle: { borderColor: textColor, borderWidth: 1 } },
        },
      ],
    },
  };
}

const renderConfidenceInterval: CustomSeriesRenderItem = (_params, api) => {
  const low = Number(api.value(0));
  const high = Number(api.value(1));
  const estimate = Number(api.value(2));
  const row = Number(api.value(3));
  const start = api.coord([low, row]);
  const end = api.coord([high, row]);
  const point = api.coord([estimate, row]);
  return {
    type: "group",
    children: [
      {
        type: "rect",
        shape: {
          x: Math.min(start[0], end[0]),
          y: start[1] - 1,
          width: Math.max(1, Math.abs(end[0] - start[0])),
          height: 2,
        },
        style: { fill: RESEARCH_CHART_COLORS[2] },
      },
      ...[start, end].map((position) => ({
        type: "rect" as const,
        shape: { x: position[0] - 1, y: position[1] - 6, width: 2, height: 12 },
        style: { fill: RESEARCH_CHART_COLORS[2] },
      })),
      {
        type: "circle",
        shape: { cx: point[0], cy: point[1], r: 5 },
        style: { fill: RESEARCH_CHART_COLORS[0] },
      },
    ],
  };
};

interface ForestRow {
  name: string;
  estimate: number;
  low: number;
  high: number;
}

function forestSpec(
  id: "ols-coefficients" | "conditional-indirect" | "simple-slopes",
  rows: ForestRow[],
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  if (!rows.length) return null;
  const title =
    id === "ols-coefficients"
      ? labels.olsCoefficientsTitle
      : id === "conditional-indirect"
        ? labels.conditionalIndirectTitle
        : labels.simpleSlopesTitle;
  const description =
    id === "ols-coefficients"
      ? labels.olsCoefficientsDescription
      : id === "conditional-indirect"
        ? labels.conditionalIndirectDescription
        : labels.simpleSlopesDescription;
  return {
    id,
    title,
    description,
    height: Math.max(270, 112 + rows.length * 50),
    option: {
      ...baseOption(),
      grid: { left: "32%", right: 40, top: 40, bottom: 56 },
      xAxis: {
        ...valueAxis(labels.estimateAxis),
        nameLocation: "middle",
        nameGap: 32,
        min: (extent) =>
          Math.min(0, extent.min) - (extent.max - extent.min) * 0.08,
        max: (extent) =>
          Math.max(0, extent.max) + (extent.max - extent.min) * 0.08,
      },
      yAxis: categoryAxis(
        rows.map((row) => row.name),
        true,
      ),
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: (params: TopLevelFormatterParams) => {
          const row = rows[tooltipParam(params).dataIndex];
          return row
            ? `${row.name}\n${labels.estimate}: ${decimal(row.estimate)}\n${labels.confidenceInterval}: [${decimal(row.low)}, ${decimal(row.high)}]`
            : "";
        },
      },
      series: [
        {
          type: "custom",
          renderItem: renderConfidenceInterval,
          encode: { x: [0, 1, 2], y: 3 },
          data: rows.map((row, index) => [
            row.low,
            row.high,
            row.estimate,
            index,
          ]),
        },
        {
          type: "scatter",
          data: [],
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: mutedColor, type: "dashed", width: 1 },
            data: [{ xAxis: 0 }],
          },
        },
      ],
    },
  };
}

function olsSpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "coefficients");
  if (!table) return null;
  return forestSpec(
    "ols-coefficients",
    table.rows.flatMap((row) =>
      text(row.term) &&
      finite(row.estimate) &&
      finite(row.ciLow) &&
      finite(row.ciHigh)
        ? [
            {
              name: row.term,
              estimate: row.estimate,
              low: row.ciLow,
              high: row.ciHigh,
            },
          ]
        : [],
    ),
    labels,
  );
}

function conditionalIndirectSpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "conditional_indirect");
  if (!table) return null;

  return forestSpec(
    "conditional-indirect",
    table.rows.flatMap((row, effectIndex) => {
      if (!finite(row.estimate) || !finite(row.ciLow) || !finite(row.ciHigh))
        return [];
      const fallback = text(row.effect) ? row.effect : String(effectIndex + 1);
      const name = labels.conditionalEffects[effectIndex] ?? fallback;
      return [
        { name, estimate: row.estimate, low: row.ciLow, high: row.ciHigh },
      ];
    }),
    labels,
  );
}

function simpleSlopesSpec(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  labels: ResearchChartLabels,
): ResearchChartSpec | null {
  const table = tableById(run, "simple_slopes");
  if (!table) return null;
  return forestSpec(
    "simple-slopes",
    table.rows.flatMap((row) =>
      finite(row.moderatorLevel) &&
      finite(row.estimate) &&
      finite(row.ciLow) &&
      finite(row.ciHigh)
        ? [
            {
              name: `W = ${decimal(row.moderatorLevel)} SD`,
              estimate: row.estimate,
              low: row.ciLow,
              high: row.ciHigh,
            },
          ]
        : [],
    ),
    labels,
  );
}

function decorateOptionWithStyle(
  spec: ResearchChartSpec,
  style: ResolvedSurveyChartStyle,
): ResearchChartSpec {
  const option: Record<string, unknown> = {
    ...(spec.option as Record<string, unknown>),
    backgroundColor: style.backgroundColor,
    color: [...style.colors],
    textStyle: {
      color: style.textColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSizePx,
    },
  };

  const recolorAxis = (raw: unknown, isY = false): unknown => {
    if (!raw || typeof raw !== "object") return raw;
    const axis = { ...(raw as Record<string, unknown>) };
    const existingAxisLine = (axis.axisLine as Record<string, unknown> | undefined) ?? {};
    axis.axisLine = {
      ...existingAxisLine,
      lineStyle: {
        ...((existingAxisLine.lineStyle as Record<string, unknown> | undefined) ?? {}),
        color: style.lineColor,
      },
    };
    const existingLabel = (axis.axisLabel as Record<string, unknown> | undefined) ?? {};
    axis.axisLabel = {
      ...existingLabel,
      color: axis.type === "category" ? style.textColor : style.mutedColor,
      fontSize: Math.max(10, style.fontSizePx - 1),
    };
    const existingNameStyle = (axis.nameTextStyle as Record<string, unknown> | undefined) ?? {};
    axis.nameTextStyle = {
      ...existingNameStyle,
      color: style.mutedColor,
      fontSize: Math.max(10, style.fontSizePx - 1),
      ...(isY && typeof axis.name === "string" && axis.name.trim()
        ? { align: "left", padding: [0, 0, 2, 0] }
        : {}),
    };
    if (isY && typeof axis.name === "string" && axis.name.trim()) {
      axis.nameGap = Math.max(12, typeof axis.nameGap === "number" ? axis.nameGap : 12);
    }
    const existingSplit = (axis.splitLine as Record<string, unknown> | undefined) ?? {};
    if (axis.type !== "category" || existingSplit.show) {
      axis.splitLine = {
        ...existingSplit,
        show: style.showGrid,
        lineStyle: {
          ...((existingSplit.lineStyle as Record<string, unknown> | undefined) ?? {}),
          color: style.lineColor,
        },
      };
    }
    return axis;
  };

  if (option.xAxis) option.xAxis = recolorAxis(option.xAxis, false);
  if (option.yAxis) option.yAxis = recolorAxis(option.yAxis, true);

  if (option.visualMap && typeof option.visualMap === "object") {
    const vm = { ...(option.visualMap as Record<string, unknown>) };
    vm.textStyle = { color: style.mutedColor, fontSize: Math.max(10, style.fontSizePx - 1) };
    vm.inRange = { color: [...style.sequential] };
    option.visualMap = vm;
  }

  if (Array.isArray(option.series)) {
    option.series = option.series.map((raw, idx) => {
      if (!raw || typeof raw !== "object") return raw;
      const s = { ...(raw as Record<string, unknown>) };
      if (s.type === "bar") {
        const isHorizontal = spec.id === "reliability-alpha";
        const r = style.barBorderRadius;
        s.itemStyle = {
          ...((s.itemStyle as Record<string, unknown> | undefined) ?? {}),
          color: style.colors[idx % style.colors.length],
          borderRadius: r > 0 ? (isHorizontal ? [0, r, r, 0] : [r, r, 0, 0]) : 0,
        };
        if (s.label && typeof s.label === "object") {
          s.label = { ...(s.label as Record<string, unknown>), color: style.textColor };
        }
      } else if (s.type === "heatmap") {
        const sep =
          style.backgroundColor === "transparent" ? "#FFFFFF" : style.backgroundColor;
        s.itemStyle = {
          ...((s.itemStyle as Record<string, unknown> | undefined) ?? {}),
          borderColor: sep,
        };
        if (s.label && typeof s.label === "object") {
          s.label = { ...(s.label as Record<string, unknown>), color: "#1E293B" };
        }
      } else if (s.type === "custom") {
        // 误差棒/森林图点与区间使用主题色板第 0 / 2 色，保证主题切换即时生效。
        s.renderItem = createConfidenceIntervalRenderer(
          style.colors[0],
          style.colors[2] ?? style.colors[1] ?? style.colors[0],
        );
      } else if (s.markLine && typeof s.markLine === "object") {
        const ml = { ...(s.markLine as Record<string, unknown>) };
        ml.lineStyle = {
          ...((ml.lineStyle as Record<string, unknown> | undefined) ?? {}),
          color: style.mutedColor,
        };
        s.markLine = ml;
      }
      return s;
    });
  }

  let height = spec.height;
  if (option.grid && typeof option.grid === "object") {
    const grid = { ...(option.grid as Record<string, unknown>) };
    const baseTop = typeof grid.top === "number" ? grid.top : 44;
    const minSafeTop = spec.id === "efa-variance" ? 54 : 44;
    let nextTop = Math.max(baseTop, minSafeTop);
    if (style.showHeader && spec.title.trim()) {
      const hasSub = Boolean(spec.description.trim());
      const headerOffset = hasSub ? 56 : 36;
      option.title = {
        show: true,
        text: spec.title,
        ...(hasSub ? { subtext: spec.description } : {}),
        left: 16,
        top: 12,
        itemGap: 4,
        textStyle: {
          color: style.textColor,
          fontFamily: style.fontFamily,
          fontSize: Math.round(style.fontSizePx * 1.25),
          fontWeight: 600,
        },
        ...(hasSub
          ? {
              subtextStyle: {
                color: style.mutedColor,
                fontFamily: style.fontFamily,
                fontSize: Math.max(10.5, style.fontSizePx - 1),
              },
            }
          : {}),
      };
      nextTop += headerOffset;
      height += headerOffset;
    }
    grid.top = nextTop;
    option.grid = grid;
  }

  return {
    ...spec,
    height,
    option: option as EChartsOption,
  };
}

function createConfidenceIntervalRenderer(
  pointColor: string,
  bandColor: string,
): CustomSeriesRenderItem {
  return (_params, api) => {
    const low = Number(api.value(0));
    const high = Number(api.value(1));
    const estimate = Number(api.value(2));
    const row = Number(api.value(3));
    const start = api.coord([low, row]);
    const end = api.coord([high, row]);
    const point = api.coord([estimate, row]);
    return {
      type: "group",
      children: [
        {
          type: "rect",
          shape: {
            x: Math.min(start[0], end[0]),
            y: start[1] - 1,
            width: Math.max(1, Math.abs(end[0] - start[0])),
            height: 2,
          },
          style: { fill: bandColor },
        },
        ...[start, end].map((position) => ({
          type: "rect" as const,
          shape: { x: position[0] - 1, y: position[1] - 6, width: 2, height: 12 },
          style: { fill: bandColor },
        })),
        {
          type: "circle",
          shape: { cx: point[0], cy: point[1], r: 5 },
          style: { fill: pointColor },
        },
      ],
    };
  };
}

export function buildResearchChartSpecs(
  run: Pick<ResearchRunDetail, "recipe" | "result">,
  options: {
    labels?: Partial<ResearchChartLabels>;
    style?: Partial<SurveyChartViewStyle>;
    isDark?: boolean;
  } = {},
): ResearchChartSpec[] {
  const labels: ResearchChartLabels = {
    ...defaultLabels,
    ...options.labels,
    conditionalEffects:
      options.labels?.conditionalEffects ?? defaultLabels.conditionalEffects,
  };
  const resolvedStyle = resolveSurveyChartTheme(options.style, options.isDark);
  const rawSpecs = (() => {
    switch (run.recipe.type) {
      case "reliability": {
        const chart = reliabilitySpec(run, labels);
        return chart ? [chart] : [];
      }
      case "efa":
        return [
          efaVarianceSpec(run, labels),
          efaLoadingsSpec(run, labels),
        ].filter((chart): chart is ResearchChartSpec => chart !== null);
      case "ols": {
        const chart = olsSpec(run, labels);
        return chart ? [chart] : [];
      }
      case "moderatedMediation":
        return [
          conditionalIndirectSpec(run, labels),
          simpleSlopesSpec(run, labels),
        ].filter((chart): chart is ResearchChartSpec => chart !== null);
    }
  })();
  return rawSpecs.map((spec) => decorateOptionWithStyle(spec, resolvedStyle));
}
