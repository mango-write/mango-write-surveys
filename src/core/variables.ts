// 题目 → 变量字典的展开（issue #217）：变量字典、CSV 导出与 research-data
// 数据集三处共用同一份口径，任何一处不得自写第二套展开。多变量题（排序/矩阵/
// 多项填空）每行/项一个变量，变量 id 是 `${questionId}.${子 id}`——questionId
// 与子 id 都过 idSchema（无点号），分隔符无歧义。
import type {
  SurveyAnswers,
  SurveyDefinition,
  SurveyLabeledNode,
  SurveyQuestion,
} from "./definition.js";

export type SurveyVariableKind =
  | "categorical"
  | "multiple"
  | "ordinal"
  | "number"
  | "text"
  | "date";

export interface SurveyColumnVariable {
  id: string;
  /** 所属题目 id：调用方借此把题目答案投影到各变量单元格。 */
  questionId: string;
  label: string;
  kind: SurveyVariableKind;
  options?: Array<{ id: string; label: string }>;
}

export interface SurveyVariableGroup {
  question: SurveyQuestion;
  variables: SurveyColumnVariable[];
}

function labeledOptions(nodes: SurveyLabeledNode[]): {
  id: string;
  label: string;
}[] {
  return nodes.map((node) => ({ id: node.id, label: node.label }));
}

function spanOptions(from: number, to: number): {
  id: string;
  label: string;
}[] {
  const options: { id: string; label: string }[] = [];
  for (let step = from; step <= to; step += 1)
    options.push({ id: String(step), label: String(step) });
  return options;
}

/** 单变量题：变量 id 即题目 id，CSV/数据集保持历史口径。 */
function singleVariable(
  question: SurveyQuestion,
  kind: SurveyVariableKind,
  options?: Array<{ id: string; label: string }>,
): SurveyColumnVariable {
  return {
    id: question.id,
    questionId: question.id,
    label: question.title,
    kind,
    ...(options ? { options } : {}),
  };
}

/** 单题的变量展开；statement 不产生变量。 */
export function surveyVariablesOf(question: SurveyQuestion): SurveyColumnVariable[] {
  const combined = (node: SurveyLabeledNode): string =>
    `${question.title}·${node.label}`;
  switch (question.type) {
    case "single":
    case "dropdown":
    case "image_single":
      // 图片题的取值域只有选项 id：图片是选项的呈现面，不进变量字典。
      return [
        singleVariable(question, "categorical", labeledOptions(question.options)),
      ];
    case "multiple":
    case "image_multiple":
      return [
        singleVariable(question, "multiple", labeledOptions(question.options)),
      ];
    case "ranking":
      // 每个选项一个 ordinal 变量，值是该选项的名次 1..n。
      return question.options.map((option) => ({
        id: `${question.id}.${option.id}`,
        questionId: question.id,
        label: combined(option),
        kind: "ordinal",
        options: spanOptions(1, question.options.length),
      }));
    case "text":
      return [singleVariable(question, "text")];
    case "time":
      return [singleVariable(question, "text")];
    case "number":
      return [singleVariable(question, "number")];
    case "scale":
      return [
        singleVariable(
          question,
          "ordinal",
          spanOptions(question.min, question.max),
        ),
      ];
    case "rating":
      return [singleVariable(question, "ordinal", spanOptions(1, question.max))];
    case "nps":
      return [singleVariable(question, "ordinal", spanOptions(0, 10))];
    case "date":
      return [singleVariable(question, "date")];
    case "matrix_single":
      // 每行一个 ordinal 变量，值是所选列的位次；options 把位次映射回列文案。
      return question.rows.map((row) => ({
        id: `${question.id}.${row.id}`,
        questionId: question.id,
        label: combined(row),
        kind: "ordinal",
        options: question.columns.map((column, index) => ({
          id: String(index + 1),
          label: column.label,
        })),
      }));
    case "matrix_multiple":
      // 每行一个 multiple 变量，值是所选列 id 集合（与多选同一口径）。
      return question.rows.map((row) => ({
        id: `${question.id}.${row.id}`,
        questionId: question.id,
        label: combined(row),
        kind: "multiple",
        options: labeledOptions(question.columns),
      }));
    case "multi_text":
      return question.items.map((item) => ({
        id: `${question.id}.${item.id}`,
        questionId: question.id,
        label: combined(item),
        kind: "text",
      }));
    case "matrix_text":
      // 每行一个 text 变量（与多项填空同口径），值是行文本。
      return question.rows.map((row) => ({
        id: `${question.id}.${row.id}`,
        questionId: question.id,
        label: combined(row),
        kind: "text",
      }));
    case "statement":
      return [];
  }
}

export function surveyVariables(definition: SurveyDefinition): SurveyColumnVariable[] {
  return definition.questions.flatMap(surveyVariablesOf);
}

/**
 * 题目答案 → 某个展开变量的单元格值（CSV 与数据集同口径）。undefined/形状不符
 * 一律返回 null（缺失），不猜测、不构造 0。
 */
export function surveyCellValue(
  question: SurveyQuestion,
  variableId: string,
  answer: SurveyAnswers[string] | undefined,
): string | number | string[] | null {
  if (answer === undefined) return null;
  const subId = variableId.slice(question.id.length + 1);
  switch (question.type) {
    case "ranking": {
      if (!Array.isArray(answer)) return null;
      const rank = answer.indexOf(subId);
      return rank === -1 ? null : rank + 1;
    }
    case "matrix_single": {
      if (typeof answer !== "object" || Array.isArray(answer)) return null;
      const columnId = (answer as Record<string, unknown>)[subId];
      if (typeof columnId !== "string") return null;
      const at = question.columns.findIndex((c) => c.id === columnId);
      return at === -1 ? null : at + 1;
    }
    case "matrix_multiple": {
      if (typeof answer !== "object" || Array.isArray(answer)) return null;
      const picked = (answer as Record<string, unknown>)[subId];
      if (!Array.isArray(picked)) return null;
      return picked.filter((v): v is string => typeof v === "string");
    }
    case "multi_text":
    case "matrix_text": {
      if (typeof answer !== "object" || Array.isArray(answer)) return null;
      const value = (answer as Record<string, unknown>)[subId];
      return typeof value === "string" ? value : null;
    }
    default:
      // 单变量题：变量 id 即题目 id，答案原样就是单元格值。
      if (
        typeof answer === "string" ||
        typeof answer === "number" ||
        Array.isArray(answer)
      )
        return answer;
      return null;
  }
}
