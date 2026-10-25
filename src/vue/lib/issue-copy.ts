// 校验 issue → 用户可读文案。validateSurveyDefinition 的 issue code 与 path
// 是内部坐标（questions.1.showIf 之类），不能直接给用户看；这里按 path 解析出
// 题干摘要 / 页序，逐 code 映射成动作指引。未知 code 的兜底不带任何内部路径。
import { useI18n } from "vue-i18n";

import type { SurveyDefinition, SurveyIssue } from "../../core/index.js";

type Translate = (key: string, params?: Record<string, unknown>) => string;

type IssueScope =
  | { kind: "question"; title: string }
  | { kind: "page"; n: number }
  | { kind: "none" };

function scopeOf(def: SurveyDefinition, path: string): IssueScope {
  const question = /^questions\.(\d+)\b/.exec(path);
  if (question) {
    const q = def.questions[Number(question[1])];
    if (q) return { kind: "question", title: q.title };
  }
  const page = /\bpages\.(\d+)\b/.exec(path);
  if (page) return { kind: "page", n: Number(page[1]) + 1 };
  return { kind: "none" };
}

/** 单条 issue 的人话描述；未知结构时回落到不带内部路径的通用句。 */
export function describeSurveyIssue(
  def: SurveyDefinition,
  issue: SurveyIssue,
  t: Translate,
): string {
  const scope = scopeOf(def, issue.path);
  const q = scope.kind === "question" ? scope.title : "";
  const n = scope.kind === "page" ? scope.n : 0;
  switch (issue.code) {
    case "empty_page":
      return t("surveys.issue.emptyPage", { n });
    case "duplicate_id":
      if (scope.kind === "page") return t("surveys.issue.duplicatePageId", { n });
      if (scope.kind === "question") return t("surveys.issue.duplicateQuestionId", { q });
      return t("surveys.issue.duplicateIdGeneric");
    case "empty_options":
      // 排序题的下限是 2（要排出名次），文案区分于普通选择题。
      return issue.path.startsWith("questions.")
        ? def.questions[Number(/^questions\.(\d+)/.exec(issue.path)![1])]
            ?.type === "ranking"
          ? t("surveys.issue.rankingOptions", { q })
          : t("surveys.issue.emptyOptions", { q })
        : t("surveys.issue.emptyOptions", { q });
    case "invalid_choice_range":
      return issue.path.endsWith("minChoices")
        ? t("surveys.issue.minChoicesExceedMax", { q })
        : t("surveys.issue.maxChoicesExceedOptions", { q });
    case "invalid_number_range":
      return t("surveys.issue.numberRange", { q });
    case "invalid_date_range":
      return t("surveys.issue.dateRange", { q });
    case "invalid_scale_range":
      return t("surveys.issue.scaleRange", { q });
    case "statement_not_required":
      return t("surveys.issue.statementNotRequired", { q });
    case "condition_unsupported_source":
      return t("surveys.issue.conditionUnsupportedSource", { q });
    case "unknown_question":
      return scope.kind === "page"
        ? t("surveys.issue.unknownQuestionInPage", { n })
        : t("surveys.issue.unknownConditionQuestion");
    case "question_in_multiple_pages":
      return t("surveys.issue.questionInMultiplePages", { q });
    case "orphan_question":
      return t("surveys.issue.orphanQuestion", { q });
    case "condition_not_previous":
      // 跳页条件挂在 pages.N.jump 下 → 页作用域；显示条件挂在 questions.N.showIf 下 → 题作用域。
      return issue.path.includes("jump")
        ? t("surveys.issue.jumpConditionNotPrevious", { n })
        : t("surveys.issue.conditionNotPrevious", { q });
    case "condition_type_mismatch":
      return t("surveys.issue.conditionTypeMismatch", { q });
    case "condition_unknown_option":
      return t("surveys.issue.conditionUnknownOption", { q });
    case "unknown_page":
      return t("surveys.issue.unknownPage", { n });
    case "jump_not_forward":
      return t("surveys.issue.jumpNotForward", { n });
    default:
      // schema.* 等结构错误：定位到题/页，但不展示 zod message 与内部 path。
      return scope.kind === "question"
        ? t("surveys.issue.schemaQuestion", { q })
        : scope.kind === "page"
          ? t("surveys.issue.schemaPage", { n })
          : t("surveys.issue.schemaGeneric");
  }
}

/** 组件便捷封装：绑定当前 locale 的 t。 */
export function useSurveyIssueCopy() {
  const { t } = useI18n();
  return (def: SurveyDefinition, issue: SurveyIssue) =>
    describeSurveyIssue(
      def,
      issue,
      t as unknown as Translate,
    );
}
