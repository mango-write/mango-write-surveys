import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSurveyDraftHistory,
  type SurveyDraftState,
} from "./useSurveyDraftHistory";
import type { SurveyDefinition } from "../../contracts/index.js";

function stateOf(title: string, responseLimit = 100): SurveyDraftState {
  const definition: SurveyDefinition = {
    version: 1,
    title,
    description: "",
    consent: "",
    questions: [],
    pages: [],
  };
  return { definition, responseLimit };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSurveyDraftHistory", () => {
  it("commit 压栈、undo/redo 走快照；新提交清空 redo", () => {
    const history = useSurveyDraftHistory(stateOf("v0"));
    history.commit(stateOf("v1"));
    history.commit(stateOf("v2"));
    expect(history.current.value.definition.title).toBe("v2");
    expect(history.canUndo.value).toBe(true);
    expect(history.canRedo.value).toBe(false);

    expect(history.undo()?.definition.title).toBe("v1");
    expect(history.undo()?.definition.title).toBe("v0");
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(true);

    expect(history.redo()?.definition.title).toBe("v1");
    history.commit(stateOf("v3"));
    expect(history.canRedo.value).toBe(false);
    expect(history.undo()?.definition.title).toBe("v1");
  });

  it("相同 label 且间隔 ≤800ms 的连续提交合并为一条（打字）", () => {
    const history = useSurveyDraftHistory(stateOf(""));
    history.commit(stateOf("标"), { label: "title" });
    vi.advanceTimersByTime(500);
    history.commit(stateOf("标题"), { label: "title" });
    vi.advanceTimersByTime(500);
    history.commit(stateOf("标题页"), { label: "title" });
    // 一条历史 = 一步回到动作前。
    expect(history.undo()?.definition.title).toBe("");
    expect(history.canUndo.value).toBe(false);

    // 重做回最新态；超过合并窗口后的新提交成为新的一条。
    history.redo();
    vi.advanceTimersByTime(2000);
    history.commit(stateOf("标题页！"), { label: "title" });
    expect(history.undo()?.definition.title).toBe("标题页");
  });

  it("不同 label / 无 label 不合并；assistant 提交永不合并", () => {
    const history = useSurveyDraftHistory(stateOf("v0"));
    history.commit(stateOf("v1"), { label: "title" });
    history.commit(stateOf("v2"), { label: "options" });
    history.commit(stateOf("v3"), { label: "title" });
    expect(history.undo()?.definition.title).toBe("v2");
    expect(history.undo()?.definition.title).toBe("v1");
    expect(history.undo()?.definition.title).toBe("v0");

    history.commit(stateOf("a1"), { source: "assistant", label: "same" });
    history.commit(stateOf("a2"), { source: "assistant", label: "same" });
    expect(history.undo()?.definition.title).toBe("a1");
  });

  it("跨题连续编辑不合并：编辑 Q1 再编辑 Q2（间隔 <800ms），撤销一次只回退 Q2", () => {
    const questionOf = (id: string, title: string): SurveyDefinition => ({
      version: 1,
      title: "问卷",
      description: "",
      consent: "",
      questions: [
        { id: "q1", type: "text", title: id === "q1" ? title : "Q1", required: false },
        { id: "q2", type: "text", title: id === "q2" ? title : "Q2", required: false },
      ],
      pages: [{ id: "p1", title: "第一页", questionIds: ["q1", "q2"] }],
    });
    const history = useSurveyDraftHistory({
      definition: questionOf("q1", "Q1 原始"),
      responseLimit: 100,
    });
    // 两道题的打字会话紧挨着（<800ms），label 含题目 id，绝不互相合并。
    history.commit(
      { definition: questionOf("q1", "Q1 第一版"), responseLimit: 100 },
      { label: "q:q1:title" },
    );
    vi.advanceTimersByTime(100);
    history.commit(
      { definition: questionOf("q1", "Q1 第二版"), responseLimit: 100 },
      { label: "q:q1:title" },
    );
    vi.advanceTimersByTime(100);
    history.commit(
      { definition: questionOf("q2", "Q2 第一版"), responseLimit: 100 },
      { label: "q:q2:title" },
    );
    // 撤销一次：只回退 Q2 的打字会话，Q1 的两步编辑原样保留。
    const undone = history.undo();
    expect(undone?.definition.questions[0]!.title).toBe("Q1 第二版");
    expect(undone?.definition.questions[1]!.title).toBe("Q2");
  });

  it("跨目标编辑（题干 vs 页说明 vs 卷标题）label 互异，永不合并", () => {
    const history = useSurveyDraftHistory(stateOf("v0"));
    history.commit(stateOf("v1"), { label: "q:q1:title" });
    vi.advanceTimersByTime(100);
    history.commit(stateOf("v2"), { label: "page:p1:desc" });
    vi.advanceTimersByTime(100);
    history.commit(stateOf("v3"), { label: "title" });
    vi.advanceTimersByTime(100);
    // 最后一条撤销回到 v2，而不是一路回到 v0。
    expect(history.undo()?.definition.title).toBe("v2");
    expect(history.undo()?.definition.title).toBe("v1");
    expect(history.undo()?.definition.title).toBe("v0");
  });

  it("reset 清空两侧栈（load / 冲突重载口径）", () => {
    const history = useSurveyDraftHistory(stateOf("v0"));
    history.commit(stateOf("v1"));
    history.reset(stateOf("server"));
    expect(history.current.value.definition.title).toBe("server");
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
  });
});
