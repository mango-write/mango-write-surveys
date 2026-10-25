// 研究面板的客户端 CSV 预解析（issue #223 扩展缝）：只做表头解析与自动映射，
// 权威解析/规范化在服务端（../research/csv.js，5MiB/2 万行/500 列）。这里只做
// 同口径的轻量前置校验，把明显失败的文件挡在提交前；上限数值与服务端保持一致。
export const RESEARCH_CSV_MAX_BYTES = 5 * 1024 * 1024;

export type ResearchCsvErrorCode =
  | "empty"
  | "unclosed_quote"
  | "empty_header"
  | "duplicate_header"
  | "too_many_columns"
  | "no_data_row";

export class ResearchCsvError extends Error {
  constructor(readonly code: ResearchCsvErrorCode) {
    super(code);
    this.name = "ResearchCsvError";
  }
}

export interface ParsedCsvHead {
  columns: string[];
  rowCount: number;
}

/** 与 ../research/csv.js 同口径的表头解析；行只计数不保留（预览不需要单元格）。 */
export function parseCsvHead(csv: string): ParsedCsvHead {
  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const columns: string[] = [];
  let rowCount = 0;
  let field = "";
  let quoted = false;
  let firstRecord = true;
  let recordHasField = false;
  const endField = () => {
    if (firstRecord) columns.push(field.trim());
    field = "";
    recordHasField = true;
  };
  const endRecord = () => {
    endField();
    if (firstRecord) {
      firstRecord = false;
      if (columns.length === 0 || columns.some((column) => column.length === 0))
        throw new ResearchCsvError("empty_header");
      if (new Set(columns).size !== columns.length)
        throw new ResearchCsvError("duplicate_header");
      if (columns.length > 500) throw new ResearchCsvError("too_many_columns");
    } else if (recordHasField) rowCount += 1;
    recordHasField = false;
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      endRecord();
    } else field += char;
  }
  if (quoted) throw new ResearchCsvError("unclosed_quote");
  if (field.length > 0 || recordHasField) endRecord();
  if (firstRecord) throw new ResearchCsvError("empty");
  if (rowCount === 0) throw new ResearchCsvError("no_data_row");
  return { columns, rowCount };
}

export type ColumnMatchKind = "exact" | "rowItem" | "label" | "none";

export interface ColumnMappingSuggestion {
  variableId: string;
  column: string | null;
  matched: ColumnMatchKind;
}

/** 按 codebook 顺序给每个变量找唯一列：变量 id 精确 → 去掉 `questionId.` 的
 *  行/项 id → 变量 label。列一旦被占，后续变量一律留给人工确认（matched:none）。 */
export function autoMapColumns(
  variables: Array<{ id: string; label: string }>,
  columns: string[],
): ColumnMappingSuggestion[] {
  const taken = new Set<string>();
  const suggestions: ColumnMappingSuggestion[] = [];
  for (const variable of variables) {
    const candidates: Array<[string, ColumnMatchKind]> = [
      [variable.id, "exact"],
    ];
    const dot = variable.id.lastIndexOf(".");
    if (dot >= 0) candidates.push([variable.id.slice(dot + 1), "rowItem"]);
    candidates.push([variable.label, "label"]);
    let matched: ColumnMatchKind = "none";
    let column: string | null = null;
    for (const [candidate, kind] of candidates) {
      if (kind !== "none" && columns.includes(candidate) && !taken.has(candidate)) {
        column = candidate;
        matched = kind;
        taken.add(candidate);
        break;
      }
    }
    suggestions.push({ variableId: variable.id, column, matched });
  }
  return suggestions;
}

/** 人工确认后去重校验：同一列只能映射给一个变量。 */
export function findDuplicateColumn(
  mappings: Array<{ variableId: string; column: string | null }>,
): string | null {
  const seen = new Set<string>();
  for (const { column } of mappings) {
    if (!column) continue;
    if (seen.has(column)) return column;
    seen.add(column);
  }
  return null;
}
