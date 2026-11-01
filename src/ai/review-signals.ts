import type { SurveyDefinition } from "../core/index.js";

const frequency = /频率|频次|多久.{0,8}一次|how often|how frequently|frequency/i;
const recallPeriod = /(?:过去|最近|近)\s*(?:\d+|[一二三四五六七八九十两半]+)\s*(?:个)?(?:天|周|月|学期|季度|年)|本周|本月|本学期|今年|去年|(?:in|during|over)\s+(?:the\s+)?(?:past|last)\s+(?:\d+|one|two|three|six|twelve)\s+(?:days?|weeks?|months?|years?)/i;
const subjective = /经常|偶尔|常常|很少|频繁|often|sometimes|rarely|frequently/i;
const anchored = /每(?:天|周|月|年)|(?:每日|每周|每月|每年)|(?:once|twice|\d+\s+times?)\s+(?:a|per|each)\s+(?:day|week|month|year)/i;

export function surveyReviewSignals(definition: SurveyDefinition): Array<{ questionId: string; kind: "recall_period" | "frequency_anchors"; note: string }> {
  const signals: Array<{ questionId: string; kind: "recall_period" | "frequency_anchors"; note: string }> = [];
  for (const page of definition.pages) {
    for (const id of page.questionIds) {
      const question = definition.questions.find((item) => item.id === id);
      if (!question || !frequency.test(question.title)) continue;
      const context = [definition.title, definition.description, page.title, page.description ?? "", question.title].join(" ");
      if (!recallPeriod.test(context)) signals.push({ questionId: id, kind: "recall_period", note: "检查题干、说明与作答范围是否已经给出适当回忆期；缺失仅提示作者确认，不自行指定期限。" });
      const labels = "options" in question ? question.options.map((option) => option.label) : [];
      if (labels.some((label) => subjective.test(label)) && labels.some((label) => anchored.test(label))) {
        signals.push({ questionId: id, kind: "frequency_anchors", note: "检查主观频率词与定量频率选项是否混用、重叠或存在遗漏；须结合原文判断。" });
      }
    }
  }
  return signals;
}
