import { SurveyError } from "../server/errors.js";
import { canonicalJson, sha256Hex } from "../server/serialize.js";

export const RESEARCH_PARSER_VERSION = "research-csv-v1";
export const RESEARCH_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const RESEARCH_CSV_MAX_ROWS = 20_000;
export const RESEARCH_CSV_MAX_COLUMNS = 500;

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
}

export function parseResearchCsv(csv: string): ParsedCsv {
  if (Buffer.byteLength(csv, "utf8") > RESEARCH_CSV_MAX_BYTES)
    throw new SurveyError("dataset_too_large", 413, "CSV 超过 5 MiB 上限");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else field += char;
  }
  if (quoted) throw new SurveyError("invalid_csv", 400, "CSV 存在未闭合引号");
  record.push(field);
  if (record.length > 1 || record[0] !== "") records.push(record);
  if (records.length === 0)
    throw new SurveyError("invalid_csv", 400, "CSV 缺少表头");
  const columns = records.shift()!.map((value) => value.trim());
  if (columns.length > RESEARCH_CSV_MAX_COLUMNS)
    throw new SurveyError("dataset_too_large", 413, "CSV 列数超过 500 上限");
  if (columns.some((column) => column.length === 0))
    throw new SurveyError("invalid_csv", 400, "CSV 表头不能留空");
  if (new Set(columns).size !== columns.length)
    throw new SurveyError("invalid_csv", 400, "CSV 表头不能重复");
  if (records.length === 0)
    throw new SurveyError("invalid_csv", 400, "CSV 至少需要一行数据");
  if (records.length > RESEARCH_CSV_MAX_ROWS)
    throw new SurveyError("dataset_too_large", 413, "CSV 行数超过 20000 上限");
  records.forEach((row, index) => {
    if (row.length !== columns.length)
      throw new SurveyError(
        "invalid_csv",
        400,
        `CSV 第 ${index + 2} 行有 ${row.length} 列，预期 ${columns.length} 列`,
      );
  });
  return { columns, rows: records };
}

export function normalizedRowHash(row: Record<string, number | null>): string {
  return sha256Hex(canonicalJson(row));
}
