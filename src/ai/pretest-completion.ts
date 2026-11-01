export interface PretestFeedbackReceipt {
  entries: Array<{ currentContent: boolean }>;
  omitted: number;
}

export function pretestCompletionMessage(input: {
  feedback: PretestFeedbackReceipt | null;
  findingCount: number | null;
  locale?: string | null;
}): string {
  const en = input.locale?.toLowerCase().startsWith("en") ?? false;
  const { feedback, findingCount } = input;
  if (!feedback) return en ? "Could not read the test feedback. Please try again." : "试填反馈暂时无法读取，请重试。";
  if (feedback.entries.length === 0) return en ? "There is no question feedback yet. Check the test panel for responses." : "目前没有题目反馈，可在试填面板查看作答情况。";
  if (findingCount === null) return en ? "Could not prepare suggestions from the test feedback. Please try again." : "这次未能根据试填反馈生成建议，请重试。";
  let message = findingCount > 0
    ? (en ? "Test feedback is ready. Review the suggestions on the canvas." : "已整理试填反馈，请在画布查看建议。")
    : (en ? "Test feedback was reviewed; there are no suggestions to handle." : "已查看试填反馈，暂无需要处理的建议。");
  if (!feedback.entries.some((entry) => entry.currentContent)) {
    message += en ? " The feedback is from older content." : "这些反馈来自旧内容。";
  } else if (feedback.entries.some((entry) => !entry.currentContent)) {
    message += en ? " It includes feedback on older content." : "其中包含旧内容的反馈。";
  }
  if (feedback.omitted > 0) message += en ? ` ${feedback.omitted} feedback entries were not read.` : `另有 ${feedback.omitted} 条反馈未读取。`;
  return message;
}
