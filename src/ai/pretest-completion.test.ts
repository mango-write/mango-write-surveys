import { expect, it } from "vitest";
import { pretestCompletionMessage } from "./pretest-completion.js";

it("根据读取与交付事实说明试填反馈状态", () => {
  expect(pretestCompletionMessage({ feedback: null, findingCount: null })).toContain("无法读取");
  expect(pretestCompletionMessage({ feedback: { entries: [], omitted: 0 }, findingCount: null })).toContain("没有题目反馈");
  expect(pretestCompletionMessage({ feedback: { entries: [{ currentContent: true }], omitted: 0 }, findingCount: null })).toContain("未能");
  expect(pretestCompletionMessage({ feedback: { entries: [{ currentContent: true }], omitted: 2 }, findingCount: 1 })).toContain("2 条反馈未读取");
  expect(pretestCompletionMessage({ feedback: { entries: [{ currentContent: false }], omitted: 0 }, findingCount: 1 })).toContain("旧内容");
  expect(pretestCompletionMessage({ feedback: { entries: [{ currentContent: true }], omitted: 0 }, findingCount: 0, locale: "en-US" })).toContain("no suggestions");
});
