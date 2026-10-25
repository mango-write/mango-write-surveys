import { createHash, randomUUID } from "node:crypto";

import type { ResearchDatasetImportInput } from "../contracts/index.js";
import {
  surveyVariables,
  type SurveyColumnVariable,
  type SurveyDefinition,
} from "../core/index.js";
import { SurveyError } from "../server/errors.js";
import { canonicalJson } from "../server/serialize.js";

import {
  normalizedRowHash,
  parseResearchCsv,
  RESEARCH_PARSER_VERSION,
} from "./csv.js";
import type { ResearchDatasetRecord } from "./types.js";

const missingValues = new Set(["", "na", "n/a", "nan", "null", "."]);

/** 选项 id 全为有限数值的分类题才可映射为数值列（如 gender=1/2）。 */
export function numericCategoricalOptions(
  variable: SurveyColumnVariable,
): Array<{ id: string; label: string }> | null {
  if (variable.kind !== "categorical") return null;
  const options = variable.options ?? [];
  if (options.length === 0 || !options.every((option) => Number.isFinite(Number(option.id))))
    return null;
  return options;
}

function parseNumber(raw: string, variable: SurveyColumnVariable, row: number): number | null {
  const value = raw.trim();
  if (missingValues.has(value.toLowerCase())) return null;
  if (variable.kind === "number") {
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value))
      throw new SurveyError("invalid_csv_value", 400, `第 ${row} 行 ${variable.id} 不是合法数值`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
      throw new SurveyError("invalid_csv_value", 400, `第 ${row} 行 ${variable.id} 不是有限数值`);
    return parsed;
  }
  if (variable.kind === "categorical") {
    // 按选项 id/label 解码；数值形态也必须在选项域内——域外数值（如 gender=3）
    // 不能借 Number() 直查静默进模型。
    const options = numericCategoricalOptions(variable)!;
    const option = options.find((candidate) => candidate.id === value || candidate.label === value);
    if (option) return Number(option.id);
    const numeric = Number(value);
    if (value !== "" && Number.isFinite(numeric) && options.some((candidate) => Number(candidate.id) === numeric))
      return numeric;
    throw new SurveyError("invalid_csv_value", 400, `第 ${row} 行 ${variable.id} 无法按 codebook 解码`);
  }
  const direct = Number(value);
  if (value.trim() !== "" && Number.isFinite(direct)) return direct;
  const option = variable.options?.find(
    (candidate) => candidate.id === value || candidate.label === value,
  );
  if (!option)
    throw new SurveyError("invalid_csv_value", 400, `第 ${row} 行 ${variable.id} 无法按 codebook 解码`);
  const parsed = Number(option.id);
  if (!Number.isFinite(parsed))
    throw new SurveyError("invalid_csv_value", 400, `变量 ${variable.id} 的 ordinal 选项不是数值`);
  return parsed;
}

export function importResearchDataset(input: {
  surveyId: string;
  revisionId: string;
  definition: SurveyDefinition;
  payload: ResearchDatasetImportInput;
}): ResearchDatasetRecord {
  const parsed = parseResearchCsv(input.payload.csv);
  const variables = surveyVariables(input.definition);
  const byId = new Map(variables.map((variable) => [variable.id, variable]));
  const variableIds = new Set<string>();
  const columns = new Set<string>();
  for (const mapping of input.payload.mapping) {
    const variable = byId.get(mapping.variableId);
    if (!variable || !(variable.kind === "number" || variable.kind === "ordinal" || numericCategoricalOptions(variable)))
      throw new SurveyError("invalid_mapping", 400, `变量 ${mapping.variableId} 不可映射为数值`);
    if (!parsed.columns.includes(mapping.column))
      throw new SurveyError("invalid_mapping", 400, `CSV 不存在列 ${mapping.column}`);
    if (variableIds.has(mapping.variableId) || columns.has(mapping.column))
      throw new SurveyError("invalid_mapping", 400, "变量与 CSV 列必须一一对应");
    variableIds.add(mapping.variableId);
    columns.add(mapping.column);
  }
  const mapping = [...input.payload.mapping].sort((a, b) => a.variableId.localeCompare(b.variableId));
  const rows = parsed.rows.map((csvRow, rowIndex) => {
    const row: Record<string, number | null> = {};
    for (const item of mapping) {
      const variable = byId.get(item.variableId)!;
      row[item.variableId] = parseNumber(
        csvRow[parsed.columns.indexOf(item.column)]!,
        variable,
        rowIndex + 2,
      );
    }
    return row;
  });
  const sourceSha256 = createHash("sha256").update(input.payload.csv, "utf8").digest("hex");
  const normalizedRowHashes = rows.map(normalizedRowHash);
  // 完全重复记录只计数披露，不删除——公开数据的重复行是分析样本的一部分。
  const duplicateRowCount = normalizedRowHashes.length - new Set(normalizedRowHashes).size;
  const rowsHash = createHash("sha256").update(canonicalJson(normalizedRowHashes), "utf8").digest("hex");
  const inputHash = createHash("sha256")
    .update(canonicalJson({
      surveyId: input.surveyId,
      revisionId: input.revisionId,
      name: input.payload.name,
      source: input.payload.source,
      sourceSha256,
      parserVersion: RESEARCH_PARSER_VERSION,
      mapping,
      rowsHash,
    }))
    .digest("hex");
  return {
    id: randomUUID(),
    surveyId: input.surveyId,
    revisionId: input.revisionId,
    name: input.payload.name,
    source: input.payload.source,
    sourceSha256,
    parserVersion: RESEARCH_PARSER_VERSION,
    rowCount: rows.length,
    duplicateRowCount,
    mapping,
    columns: parsed.columns,
    normalizedRows: rows,
    normalizedRowHashes,
    rowsHash,
    inputHash,
    createdAt: new Date(),
  };
}
