import type { SurveyResearchTable } from "../contracts/index.js";

export function escapeHtml(value: unknown): string {
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

export function renderResearchTable(table: SurveyResearchTable): string {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(table.title)}完整结果表"><table><thead><tr>${table.columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${table.columns.map((column) => `<td>${escapeHtml(display(row[column.key] ?? null))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderTextList(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderMetaRow(label: string, value: unknown, className = ""): string {
  return `<dt>${escapeHtml(label)}</dt><dd${className ? ` class="${className}"` : ""}>${escapeHtml(value)}</dd>`;
}
