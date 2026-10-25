import { csvCell } from "../server/serialize.js";

import type { ResearchDatasetRecord, ResearchRunRecord } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function display(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "非有限值";
  return value;
}

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

export function renderResearchReportHtml(input: {
  run: ResearchRunRecord;
  dataset: ResearchDatasetRecord;
}): string {
  const { run, dataset, } = input;
  const sourceLabel = dataset.source.kind === "synthetic" ? "合成数据（非真实受试者证据）" : "公开外部数据";
  const duplicateWarning = dataset.duplicateRowCount > 0
    ? `<section class="notice"><strong>数据质量警告</strong>：${escapeHtml(duplicateRowWarning(dataset.duplicateRowCount))}</section>`
    : "";
  const sections = run.result.tables.map((table) => `
<section><h2>${escapeHtml(table.title)}</h2><div class="scroll"><table><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${table.columns.map((column) => `<td>${escapeHtml(display(row[column.key] ?? null))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`).join("");
  const list = (title: string, items: string[]) => items.length ? `<section><h2>${title}</h2><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(dataset.name)} · 固定分析报告</title><style>
:root{color-scheme:light;--ink:CanvasText;--muted:GrayText;--line:ButtonBorder;--accent:LinkText;--warn:Canvas;--radius-md:12px}*{box-sizing:border-box}body{margin:0;background:Canvas;color:var(--ink);font:14px/1.6 system-ui,-apple-system,sans-serif}main{max-width:1180px;margin:auto;padding:32px}header,section{background:Canvas;border:1px solid var(--line);border-radius:var(--radius-md);padding:22px;margin-bottom:18px}h1{font-size:25px;margin:0 0 12px}h2{font-size:18px;margin:0 0 14px}.source{border-left:6px solid var(--accent);font-size:16px}.synthetic{border-left-color:MarkText;background:Mark}.notice{background:var(--warn);font-size:15px}.meta{display:grid;grid-template-columns:minmax(150px,240px) 1fr;gap:5px 16px;overflow-wrap:anywhere}.meta dt{color:var(--muted)}.meta dd{margin:0}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid var(--line);padding:8px;white-space:nowrap}.hash{font-family:ui-monospace,monospace;font-size:12px}@media print{body{background:Canvas}main{max-width:none;padding:0}header,section{break-inside:avoid}.scroll{overflow:visible}}
</style></head><body><main><header class="source${dataset.source.kind === "synthetic" ? " synthetic" : ""}"><strong>${sourceLabel}</strong><h1>${escapeHtml(dataset.name)}</h1><p>${escapeHtml(dataset.source.title)}</p>${dataset.source.citation ? `<p>引用：${escapeHtml(dataset.source.citation)}</p>` : ""}${dataset.source.url ? `<p>来源 URL：${escapeHtml(dataset.source.url)}</p>` : ""}${dataset.source.license ? `<p>许可：${escapeHtml(dataset.source.license)}</p>` : ""}<p>说明：${escapeHtml(dataset.source.note)}</p></header>
${duplicateWarning}
<section><h2>复核信息</h2><dl class="meta"><dt>Run ID</dt><dd>${run.id}</dd><dt>Survey / revision</dt><dd>${run.surveyId} / ${run.revisionId}</dd><dt>数据集原始行数</dt><dd>${dataset.rowCount}</dd><dt>其中完全重复记录</dt><dd>${dataset.duplicateRowCount}</dd><dt>本分析有效 n / 缺失行</dt><dd>${run.result.effectiveN} / ${run.result.missingRows}</dd><dt>方法</dt><dd>${escapeHtml(run.result.method)}</dd><dt>Recipe</dt><dd>${escapeHtml(JSON.stringify(run.recipe))}</dd><dt>Engine</dt><dd>${run.engineVersion}</dd><dt>Parser</dt><dd>${dataset.parserVersion}</dd><dt>CSV SHA-256</dt><dd class="hash">${dataset.sourceSha256}</dd><dt>规范化行 SHA-256</dt><dd class="hash">${dataset.rowsHash}</dd><dt>输入 SHA-256</dt><dd class="hash">${run.inputHash}</dd><dt>结果 SHA-256</dt><dd class="hash">${run.resultHash}</dd><dt>生成时间</dt><dd>${run.createdAt.toISOString()}</dd></dl></section>
${sections}${list("警告", run.result.warnings)}${list("限制", run.result.limitations)}<section><h2>解释边界</h2><p>所有数值均由上述确定性引擎从固定输入生成，未由语言模型填写。此报告不包含原始数据行，也不把信度、效度或间接效应当作因果证明。</p></section></main></body></html>`;
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
