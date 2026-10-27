// 试填提纲生成（issue #224）：按 CDC 作答复核四过程逐题给出通俗探查问题。
// 措辞铁律：读者是非专业作者与其试填对象，不出现「认知访谈」这类方法学黑话；
// 结构与措辞分离——默认措辞为中文（与 core 其他用户可见消息同口径），UI 层可
// 传入本地化 phrasing，纯函数只负责选题、排序与组装。
import type { SurveyDefinition, SurveyPretestAspect } from "./definition.js";

export interface CognitiveInterviewGuideItem {
  questionId: string;
  title: string;
  aspect: SurveyPretestAspect;
  prompt: string;
}

export interface CognitiveInterviewGuide {
  title: string;
  intro: string;
  items: CognitiveInterviewGuideItem[];
}

export interface CognitiveInterviewPhrasing {
  intro(context: { title: string; questions: number }): string;
  probe(aspect: SurveyPretestAspect, title: string): string;
}

const defaultPhrasing: CognitiveInterviewPhrasing = {
  intro: ({ title, questions }) =>
    `这是《${title}》的试填提纲：请 2–5 位与目标人群条件相近的人帮忙试答（全卷共 ${questions} 道题）。` +
    "逐题问下面的探查问题，把对方的原话记下来，不要概括。" +
    "记完后回到问卷工作台的「试填反馈」面板，按题录入并保存。",
  probe: (aspect, title) => {
    switch (aspect) {
      case "comprehension":
        return `请TA先用自己的话说说，这道题「${title}」在问什么。TA的理解和你的意思不一致时，记下TA的原话。`;
      case "recall":
        return `这道题「${title}」需要TA回忆过去的事吗？TA是凭印象还是能查到记录？想不起来的部分请TA说说难在哪里。`;
      case "judgment":
        return `问TA回答「${title}」时有没有犹豫：某个词是什么意思（比如「经常」是多经常），或者找不到符合TA情况的答案。`;
      case "response":
        return `请TA说说最后是怎么选出这个答案的：心里想要的答案在选项里吗？有没有想选「其他」却没有这一项？`;
    }
  },
};

/** 按页序展开可答题（说明块不收集答案，跳过）；每题按四过程各生成一条探查问题。 */
export function buildCognitiveInterviewGuide(
  definition: SurveyDefinition,
  phrasing: CognitiveInterviewPhrasing = defaultPhrasing,
): CognitiveInterviewGuide {
  const byId = new Map(definition.questions.map((question) => [question.id, question]));
  const ordered = definition.pages.flatMap((page) =>
    page.questionIds.flatMap((questionId) => {
      const question = byId.get(questionId);
      return question && question.type !== "statement" ? [question] : [];
    }),
  );
  const aspects: SurveyPretestAspect[] = ["comprehension", "recall", "judgment", "response"];
  return {
    title: definition.title,
    intro: phrasing.intro({ title: definition.title, questions: ordered.length }),
    items: ordered.flatMap((question) =>
      aspects.map((aspect) => ({
        questionId: question.id,
        title: question.title,
        aspect,
        prompt: phrasing.probe(aspect, question.title),
      })),
    ),
  };
}

/** 提纲 → 纯文本（剪贴板用）：逐题编号，探查问题缩进列表。 */
export function formatCognitiveInterviewGuide(guide: CognitiveInterviewGuide): string {
  const lines: string[] = [guide.intro];
  let currentId = "";
  let index = 0;
  for (const item of guide.items) {
    if (item.questionId !== currentId) {
      index += 1;
      currentId = item.questionId;
      lines.push("", `${index}. ${item.title}`);
    }
    lines.push(`   - ${item.prompt}`);
  }
  return lines.join("\n");
}
