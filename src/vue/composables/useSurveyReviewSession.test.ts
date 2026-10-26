// 诊断会话状态机单测（issue #224 stage1）：收帧不串场、stale 判定（版本不齐 /
// 保存未落定）、应用被过期拒绝、保存成功才清 report、保存失败保留方案、
// request 的 flush 前置与无 sendPrompt 回落。history/autosave 用最小替身。
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { buildSurveyReviewPlan } from "../../core/index.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import { SurveysApiError } from "../host.js";

import {
  useSurveyReviewSession,
  type SurveyReviewDelivery,
} from "./useSurveyReviewSession.js";
import type { SurveyDraftState } from "./useSurveyDraftHistory.js";

const SURVEY_ID = "s-1";

function report(overrides: Partial<SurveyReviewDelivery> = {}): SurveyReviewDelivery {
  return {
    type: "survey_review",
    surveyId: SURVEY_ID,
    operationId: "review-op-1",
    baseDraftVersion: 2,
    summary: "澄清时间范围",
    findings: [{
      id: "f1", checkId: "wording.presumptive", questionId: "q1", title: "筛选不充分",
      severity: "major", reason: "用过不等于写过。", recommendation: "精确筛选经历。",
      suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "澄清后的单选" } }],
    }],
    ...overrides,
  };
}

interface HarnessCopilot {
  prompts: string[];
  sendPrompt?: (prompt: string, toolNames?: string[]) => Promise<void>;
  fillComposer(prompt: string): void;
  focusComposer(): void;
}

interface Harness {
  session: ReturnType<typeof useSurveyReviewSession>;
  commits: SurveyDraftState[];
  /** 排队的 flush 结果；"wait" 表示挂起直到 flushGates 放行。 */
  flushResults: Array<boolean | "wait">;
  flushGates: Array<() => void>;
  warns: string[];
  errors: string[];
  successes: string[];
  copilot: HarnessCopilot;
  setAutosaveStatus(status: "idle" | "saving" | "saved" | "error" | "conflict"): void;
  setDraftVersion(version: number): void;
}

/** 让微任务（含 flush 落地）走完：比裸 await Promise.resolve() 更稳。 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeHarness(startVersion = 2): Harness {
  const draftVersion = ref(startVersion);
  const autosaveStatus = ref<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const state = ref<SurveyDraftState>({ definition: makeDefinition(), responseLimit: 100 });
  const commits: SurveyDraftState[] = [];
  const flushResults: Array<boolean | "wait"> = [];
  const flushGates: Array<() => void> = [];
  let flushIndex = 0;
  const warns: string[] = [];
  const errors: string[] = [];
  const successes: string[] = [];
  const copilot: HarnessCopilot = {
    prompts: [],
    sendPrompt: vi.fn(async (prompt: string) => {
      copilot.prompts.push(prompt);
    }),
    fillComposer: (prompt: string) => {
      copilot.prompts.push(prompt);
    },
    focusComposer: vi.fn(() => {}),
  };
  const session = useSurveyReviewSession({
    surveyId: () => SURVEY_ID,
    canWrite: () => true,
    draftVersion: () => draftVersion.value,
    history: {
      current: state,
      commit: (next: SurveyDraftState) => {
        commits.push(next);
        state.value = next;
      },
    },
    autosave: {
      status: autosaveStatus,
      flush: async () => {
        const next = flushResults[flushIndex++];
        if (next === "wait") {
          await new Promise<void>((resolve) => flushGates.push(resolve));
          return true;
        }
        return next ?? true;
      },
      schedule: () => {},
    },
    copilot,
    notify: {
      warn: (detail: string) => {
        warns.push(detail);
      },
      error: (detail: string) => {
        errors.push(detail);
      },
      success: (detail: string) => {
        successes.push(detail);
      },
      info: () => {},
    },
    t: (key: string) => key,
  });
  return {
    session,
    commits,
    flushResults,
    flushGates,
    warns,
    errors,
    successes,
    copilot,
    setAutosaveStatus: (status) => (autosaveStatus.value = status),
    setDraftVersion: (version) => (draftVersion.value = version),
  };
}

describe("useSurveyReviewSession 收帧与丢弃", () => {
  it("只收同卷的诊断帧，别的问卷不串场；discard 一次清干净", () => {
    const { session } = makeHarness();
    session.receive(report({ surveyId: "other" }));
    expect(session.report.value).toBeNull();

    session.receive(report());
    expect(session.report.value?.operationId).toBe("review-op-1");

    session.discard();
    expect(session.report.value).toBeNull();
    expect(session.plan.value).toBeNull();
  });

  it("plan 由当前草稿与 findings 构建，addedQuestions 只列新增题", () => {
    const { session } = makeHarness();
    const base = report().findings[0]!;
    session.receive(report({
      findings: [base, {
        ...base, id: "f2", questionId: undefined,
        suggestedOps: [{
          op: "add_question", pageId: "p1",
          question: { id: "q-new", type: "text", title: "新题", required: false },
        }],
      }],
    }));
    expect(session.plan.value?.status).toBe("ready");
    expect(session.addedQuestions.value.map((question) => question.id)).toEqual(["q-new"]);
  });
});

describe("useSurveyReviewSession stale 判定", () => {
  it("版本不齐或保存未落定即过期；落定后恢复", () => {
    const { session, setDraftVersion, setAutosaveStatus } = makeHarness();
    session.receive(report({ baseDraftVersion: 2 }));
    expect(session.stale.value).toBe(false);

    setDraftVersion(3);
    expect(session.stale.value).toBe(true);
    setDraftVersion(2);

    setAutosaveStatus("saving");
    expect(session.stale.value).toBe(true);
    setAutosaveStatus("saved");
    expect(session.stale.value).toBe(false);
  });
});

describe("useSurveyReviewSession 应用", () => {
  it("整批一次 commit（source: assistant），保存成功才清 report，成功提示在落盘后", async () => {
    const { session, commits, successes } = makeHarness();
    session.receive(report());
    expect(session.plan.value?.status).toBe("ready");
    await session.apply();
    expect(commits).toHaveLength(1);
    expect(commits[0]!.definition.questions[0]!.title).toBe("澄清后的单选");
    expect(session.report.value).toBeNull();
    expect(successes).toEqual(["surveys.assistant.applied"]);
  });

  it("保存失败：不发生成功提示，只警示并保留方案", async () => {
    const { session, commits, flushResults, warns, successes } = makeHarness();
    flushResults.push(false);
    session.receive(report());
    await session.apply();
    expect(commits).toHaveLength(1);
    expect(successes).toEqual([]);
    expect(warns).toEqual(["surveys.assistant.saveFirst"]);
    expect(session.report.value?.operationId).toBe("review-op-1");
  });

  it("保存期间新 report 到达：落盘成功只清旧方案，新方案保留", async () => {
    const { session, flushResults, flushGates, successes } = makeHarness();
    flushResults.push("wait");
    session.receive(report({ operationId: "review-op-1" }));
    const applying = session.apply();
    await tick();
    // 保存仍在途时，新一轮诊断到达。
    session.receive(report({ operationId: "review-op-2" }));
    flushGates.shift()!();
    await applying;
    expect(successes).toEqual(["surveys.assistant.applied"]);
    expect(session.report.value?.operationId).toBe("review-op-2");
  });

  it("过期拒绝：stale 时 apply 不改草稿、不发保存", async () => {
    const { session, setDraftVersion, commits, flushResults } = makeHarness();
    session.receive(report());
    setDraftVersion(3);
    await session.apply();
    expect(commits).toHaveLength(0);
    expect(flushResults).toHaveLength(0);
  });
});

describe("useSurveyReviewSession request", () => {
  it("先 flush 在途保存，flush 失败只警示不发话，busy 复位", async () => {
    const { session, flushResults, warns, copilot } = makeHarness();
    flushResults.push(false);
    await session.request("review");
    expect(warns).toEqual(["surveys.assistant.saveFirst"]);
    expect(copilot.prompts).toHaveLength(0);
    expect(session.busy.value).toBe(false);
  });

  it("进入 request 即置 busy：flush 挂起时第二个请求被拒，不双发", async () => {
    const { session, flushResults, flushGates, copilot } = makeHarness();
    flushResults.push("wait");
    const first = session.request("review");
    await tick();
    expect(session.busy.value).toBe(true);

    await session.request("design");
    expect(flushGates).toHaveLength(1);

    flushGates.shift()!();
    await first;
    expect(copilot.prompts).toEqual(["surveys.assistant.reviewPrompt"]);
    expect(session.busy.value).toBe(false);
  });

  it("sendPrompt 挂起时第二个请求被拒；完成后 busy 复位", async () => {
    const { session, copilot } = makeHarness();
    const gates: Array<() => void> = [];
    copilot.sendPrompt = (prompt: string) => {
      copilot.prompts.push(prompt);
      return new Promise<void>((resolve) => gates.push(resolve));
    };
    const first = session.request("review");
    await tick();
    expect(session.busy.value).toBe(true);

    await session.request("review");
    expect(copilot.prompts).toEqual(["surveys.assistant.reviewPrompt"]);

    gates.shift()!();
    await first;
    expect(session.busy.value).toBe(false);
  });

  it("有 sendPrompt 走发话并带工具白名单；失败转错误提示", async () => {
    const { session, errors, copilot } = makeHarness();
    await session.request("review");
    expect(copilot.prompts).toEqual(["surveys.assistant.reviewPrompt"]);
    expect(copilot.sendPrompt).toHaveBeenCalledWith(
      "surveys.assistant.reviewPrompt",
      ["survey_read", "survey_review"],
    );

    copilot.sendPrompt = vi.fn(async () => {
      throw new SurveysApiError(500, "server", null);
    });
    await session.request("design");
    expect(errors).toEqual(["surveys.assistant.requestFailed"]);
    expect(session.busy.value).toBe(false);
  });

  it("宿主没有 sendPrompt：回落填入输入框并聚焦，不发请求", async () => {
    const { session, copilot } = makeHarness();
    copilot.sendPrompt = undefined;
    await session.request("design");
    expect(copilot.prompts).toEqual(["surveys.assistant.designPrompt"]);
    expect(copilot.focusComposer).toHaveBeenCalled();
    expect(session.busy.value).toBe(false);
  });
});

// buildSurveyReviewPlan 只在保存成功清理语义之外被本会话消费：冒烟一次，
// 防止 options.history 的形状漂移悄悄绕开 core 计划器。
describe("useSurveyReviewSession 与 core 计划器同源", () => {
  it("plan 与直接调用 buildSurveyReviewPlan 一致", () => {
    const { session } = makeHarness();
    const payload = report();
    session.receive(payload);
    expect(session.plan.value).toEqual(
      buildSurveyReviewPlan(makeDefinition(), payload.findings),
    );
  });
});
