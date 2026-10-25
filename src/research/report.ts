import { createRequire } from "node:module";

import { surveysBrandLogo } from "../brand.js";

import { csvCell } from "../server/serialize.js";

import { buildResearchChartSpecs } from "./chart-spec.js";
import { researchReportStyles } from "./report-theme.js";
import {
  escapeHtml,
  renderMetaRow,
  renderResearchTable,
  renderTextList,
} from "./report-view.js";
import type { ResearchDatasetRecord, ResearchRunRecord } from "./types.js";

const echarts = createRequire(import.meta.url)("echarts") as typeof import("echarts");

const duplicateRowWarning = (count: number) =>
  `存在完全重复记录，本运行未删除（共 ${count} 条）。`;

export function researchRunJson(input: { run: ResearchRunRecord; dataset: ResearchDatasetRecord }) {
  return {
    run: {
      id: input.run.id,
      surveyId: input.run.surveyId,
      revisionId: input.run.revisionId,
      datasetId: input.run.datasetId,
      recipe: input.run.recipe,
      engineVersion: input.run.engineVersion,
      inputHash: input.run.inputHash,
      resultHash: input.run.resultHash,
      createdAt: input.run.createdAt.toISOString(),
    },
    dataset: {
      id: input.dataset.id,
      name: input.dataset.name,
      source: input.dataset.source,
      sourceSha256: input.dataset.sourceSha256,
      parserVersion: input.dataset.parserVersion,
      rowsHash: input.dataset.rowsHash,
      rowCount: input.dataset.rowCount,
      duplicateRowCount: input.dataset.duplicateRowCount,
      mapping: input.dataset.mapping,
    },
    warnings: [
      ...(input.dataset.duplicateRowCount > 0 ? [duplicateRowWarning(input.dataset.duplicateRowCount)] : []),
      ...input.run.result.warnings,
    ],
    result: input.run.result,
  };
}

const analysisNames: Record<ResearchRunRecord["recipe"]["type"], string> = {
  reliability: "信度分析",
  efa: "探索性因子分析",
  ols: "回归分析",
  moderatedMediation: "有调节的中介分析",
};

const tableReading: Record<string, string> = {
  variable_mapping: "先核对构念、题目与计分方向，再阅读后续结果；映射与反向计分完整列于下表。",
  reliability: "比较各构念的 raw alpha，并同时读取有效 n 与缺失行；alpha 高低不代表单维性或结构效度。",
  efa_fit: "依次查看 KMO、Bartlett 检验与自由度；这些诊断不等同于理论结构已获验证。",
  efa_variance: "比较各因子的提取载荷平方和占题数比例，并结合理论与独立样本判断因子结构。",
  efa_loadings: "查看题目在各因子上的载荷与共同度；因子命名和保留仍需理论判断。",
  coefficients: "将系数、HC3 稳健标准误与置信区间一起阅读；区间估计不建立时间顺序或因果关系。",
  model_fit: "结合拟合指标、残差自由度与共线性诊断核对模型，不以单一指标评价研究质量。",
  mediator_model: "阅读中介方程的系数、稳健标准误与区间；横断面方程不证明中介机制。",
  outcome_model: "阅读结果方程中各项系数及交互项，并同时核对置信区间与模型诊断。",
  conditional_indirect: "比较不同 W 水平下的效应估计与 bootstrap 区间，并保留横断面关联的解释边界。",
  simple_slopes: "比较 M 在不同 W 水平下的简单斜率及区间；斜率差异不是因果证据。",
};

function renderCharts(run: ResearchRunRecord) {
  return buildResearchChartSpecs(run).map((spec) => {
    const width = 960;
    const height = spec.height ?? 360;
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
    try {
      chart.setOption({ ...spec.option, animation: false });
      return { ...spec, width, height, svg: chart.renderToSVGString() };
    } finally {
      chart.dispose();
    }
  });
}

function renderChartFigure(spec: ReturnType<typeof renderCharts>[number]): string {
  return `<figure class="chart-figure" data-chart-id="${escapeHtml(spec.id)}"><figcaption><h3 class="chart-title">${escapeHtml(spec.title)}</h3>${spec.description ? `<p class="chart-description">${escapeHtml(spec.description)}</p>` : ""}</figcaption><div class="chart-svg" style="max-width:${spec.width}px" role="img" aria-label="${escapeHtml(spec.title)}">${spec.svg}</div></figure>`;
}

const chartTableIds: Record<string, string> = {
  "reliability-alpha": "reliability",
  "efa-variance": "efa_variance",
  "efa-loadings": "efa_loadings",
  "ols-coefficients": "coefficients",
  "conditional-indirect": "conditional_indirect",
  "simple-slopes": "simple_slopes",
};

function renderAnalysisSections(run: ResearchRunRecord, charts: ReturnType<typeof renderCharts>): string {
  const used = new Set<number>();
  const chartTables = new Set(charts.map((chart) => chartTableIds[chart.id]));
  const orderedTables = [
    ...run.result.tables.filter((table) => chartTables.has(table.id)),
    ...run.result.tables.filter((table) => !chartTables.has(table.id)),
  ];
  const sections = orderedTables.map((table, index) => {
    const matches = charts.flatMap((chart, chartIndex) => {
      if (chartTableIds[chart.id] !== table.id) return [];
      used.add(chartIndex);
      return [chart];
    });
    return `<section class="analysis-section" data-table-id="${escapeHtml(table.id)}"><div class="section-heading"><span class="section-index">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(table.title)}</h2></div><p class="section-intro">${escapeHtml(tableReading[table.id] ?? "图中呈现本结果的数值关系，完整字段与精确保留值以下表为准。")}</p>${matches.map(renderChartFigure).join("")}<p class="table-caption">完整结果表 · ${table.rows.length} 行</p>${renderResearchTable(table)}</section>`;
  });
  charts.forEach((chart, index) => {
    if (used.has(index)) return;
    sections.push(`<section class="analysis-section"><div class="section-heading"><span class="section-index">图</span><h2>${escapeHtml(chart.title)}</h2></div><p class="section-intro">图形用于辅助阅读本次固定运行结果，统计明细见相应结果表。</p>${renderChartFigure(chart)}</section>`);
  });
  return sections.join("");
}

export function renderResearchReportHtml(input: {
  run: ResearchRunRecord;
  dataset: ResearchDatasetRecord;
}): string {
  const { run, dataset } = input;
  const synthetic = dataset.source.kind === "synthetic";
  const sourceLabel = synthetic ? "合成数据" : "公开外部数据";
  const sourceBoundary = synthetic
    ? "合成数据仅用于演示或流程验证，不构成真实受试者证据，不应用于实质性研究结论。"
    : "公开外部数据来自所登记来源；请按许可引用并核验样本与研究设计，平台收录不代表独立背书。";
  const warnings = [
    ...(dataset.duplicateRowCount > 0 ? [duplicateRowWarning(dataset.duplicateRowCount)] : []),
    ...run.result.warnings,
  ];
  const charts = renderCharts(run);
  const sourceFields = [
    ["来源名称", dataset.source.title],
    ["引用", dataset.source.citation],
    ["来源 URL", dataset.source.url],
    ["许可", dataset.source.license],
    ["来源说明", dataset.source.note],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(dataset.name)} · MangoWrite Surveys 研究报告</title><style>${researchReportStyles}</style></head><body><main>
<header><div class="brandbar"><span class="brand-logo">${surveysBrandLogo}</span><span class="brandproduct">Surveys</span><span class="brandnote">Research report</span></div><section class="hero"><div class="hero-top"><span class="eyebrow">${escapeHtml(analysisNames[run.recipe.type])} · 固定运行</span><span class="source-badge${synthetic ? " synthetic" : ""}">${sourceLabel}</span></div><h1>${escapeHtml(dataset.name)}</h1><p class="hero-source">${escapeHtml(dataset.source.title)}</p><p class="source-boundary">${escapeHtml(sourceBoundary)}</p></section></header>
<section class="metrics" aria-label="样本与数据概览"><div class="metric"><span class="metric-label">本分析有效 n</span><strong class="metric-value">${run.result.effectiveN}</strong><span class="metric-detail">完整病例分析</span></div><div class="metric"><span class="metric-label">缺失行</span><strong class="metric-value">${run.result.missingRows}</strong><span class="metric-detail">未填零、未插补</span></div><div class="metric"><span class="metric-label">数据集原始行</span><strong class="metric-value">${dataset.rowCount}</strong><span class="metric-detail">不含原始行内容</span></div><div class="metric${dataset.duplicateRowCount > 0 ? " warning" : ""}"><span class="metric-label">完全重复记录</span><strong class="metric-value">${dataset.duplicateRowCount}</strong><span class="metric-detail">披露但不删除</span></div></section>
${dataset.duplicateRowCount > 0 ? `<aside class="notice"><strong>数据质量提示</strong><span>${escapeHtml(duplicateRowWarning(dataset.duplicateRowCount))}请结合采集过程判断其影响。</span></aside>` : ""}
${renderAnalysisSections(run, charts)}
<aside class="appendix" aria-labelledby="review-title"><div class="section-heading"><span class="section-index">A</span><h2 id="review-title">复核附录</h2></div><p class="section-intro">保留方法、解释边界与可复现标识，供审阅和再次运行核对。</p>
<section class="appendix-block"><h3>方法</h3><p>${escapeHtml(run.result.method)}</p></section>
${warnings.length ? `<section class="appendix-block"><h3>警告</h3>${renderTextList(warnings)}</section>` : ""}
${run.result.limitations.length ? `<section class="appendix-block"><h3>限制</h3>${renderTextList(run.result.limitations)}</section>` : ""}
<section class="appendix-block"><h3>解释边界</h3><p class="interpretation">所有数值均由确定性引擎从固定输入生成，未由语言模型填写。此报告不包含原始数据行；信度、EFA、横断面关联、间接效应及调节中介指数均不构成量表认证、结构验证或因果证明。</p></section>
<section class="appendix-block"><h3>来源、引用与许可</h3><div class="source-list">${sourceFields.map(([label, value]) => `<p><span class="source-label">${escapeHtml(label)}</span>${escapeHtml(value)}</p>`).join("")}</div></section>
<section class="appendix-block"><h3>运行与版本</h3><dl class="meta">${renderMetaRow("Run ID", run.id)}${renderMetaRow("Survey ID", run.surveyId)}${renderMetaRow("Revision ID", run.revisionId)}${renderMetaRow("Dataset ID", dataset.id)}${renderMetaRow("Engine", run.engineVersion)}${renderMetaRow("Parser", dataset.parserVersion)}${renderMetaRow("生成时间", run.createdAt.toISOString())}</dl></section>
<section class="appendix-block"><h3>完整性校验</h3><dl class="meta">${renderMetaRow("CSV SHA-256", dataset.sourceSha256, "hash")}${renderMetaRow("规范化行 SHA-256", dataset.rowsHash, "hash")}${renderMetaRow("数据集输入 SHA-256", dataset.inputHash, "hash")}${renderMetaRow("运行输入 SHA-256", run.inputHash, "hash")}${renderMetaRow("结果 SHA-256", run.resultHash, "hash")}</dl></section>
<section class="appendix-block"><h3>分析配置（Recipe）</h3><pre class="recipe">${escapeHtml(JSON.stringify(run.recipe, null, 2))}</pre></section>
</aside><footer class="footer"><span>MangoWrite Surveys · AI，你的科研伙伴</span><span>固定输入 · 确定性输出 · 可离线复核</span></footer>
</main></body></html>`;
}

export function renderResearchResultCsv(input: {
  run: ResearchRunRecord;
  dataset: ResearchDatasetRecord;
}): string {
  const lines: string[] = [
    ["run_id", input.run.id],
    ["dataset_id", input.dataset.id],
    ["row_count", input.dataset.rowCount],
    ["duplicate_row_count", input.dataset.duplicateRowCount],
    ["source_kind", input.dataset.source.kind],
    ["source_sha256", input.dataset.sourceSha256],
    ["engine_version", input.run.engineVersion],
    ["input_hash", input.run.inputHash],
    ["result_hash", input.run.resultHash],
  ].map((row) => row.map(csvCell).join(","));
  for (const table of input.run.result.tables) {
    lines.push("", csvCell(`[${table.id}] ${table.title}`));
    lines.push(table.columns.map((column) => csvCell(column.label)).join(","));
    for (const row of table.rows)
      lines.push(table.columns.map((column) => csvCell(row[column.key] ?? null)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
