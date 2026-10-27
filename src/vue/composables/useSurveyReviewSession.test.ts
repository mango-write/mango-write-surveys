import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { buildSurveyReviewPlan, canonicalContentJson, sha256Hex } from "../../core/index.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { SurveyDetail, SurveyReviewDelivery } from "../../contracts/index.js";
import { SurveysApiError } from "../host.js";
import { useSurveyReviewSession } from "./useSurveyReviewSession.js";
import type { SurveyDraftState } from "./useSurveyDraftHistory.js";

const SURVEY_ID = "s-1";
type ReviewFinding = SurveyReviewDelivery["findings"][number];

const F1: ReviewFinding = {
  id: "f1", questionId: "q1", title: "筛选不充分",
  severity: "major", reason: "用过不等于写过。", recommendation: "精确筛选经历。",
  suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "澄清后的单选" } }],
};
const F2: ReviewFinding = {
  id: "f2", questionId: "q2", title: "选项互斥",
  severity: "minor", reason: "互斥规则不清。", recommendation: "澄清互斥。",
  suggestedOps: [{ op: "update_question", questionId: "q2", patch: { title: "澄清后的多选" } }],
};

function report(overrides: Partial<SurveyReviewDelivery> = {}): SurveyReviewDelivery {
  return {
    type: "survey_review",
    surveyId: SURVEY_ID,
    operationId: "review-op-1",
    baseDraftVersion: 2,
    summary: "澄清时间范围",
    findings: [F1],
    ...overrides,
  };
}

function detail(
  version: number,
  review: SurveyReviewDelivery | null,
  title?: string,
): SurveyDetail {
  const definition = makeDefinition();
  if (title) definition.questions[0]!.title = title;
  return {
    id: SURVEY_ID,
    userId: "u1",
    teamId: null,
    title: definition.title,
    slug: "slug-1",
    status: "draft",
    currentRevisionId: null,
    draftVersion: version,
    completedCount: 0,
    responseLimit: 100,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    startedCount: 0,
    definition,
    revisions: [],
    review,
    canWrite: true,
    canDelete: true,
  };
}

function makeHarness(startVersion = 2) {
  const draftVersion = ref(startVersion);
  const autosaveStatus = ref<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const state = ref<SurveyDraftState>({ definition: makeDefinition(), responseLimit: 100 });
  const commits: SurveyDraftState[] = [];
  const commitLabels: string[] = [];
  const flushResults: Array<boolean | "wait"> = [];
  const flushGates: Array<() => void> = [];
  let flushIndex = 0;
  const warns: string[] = [];
  const errors: string[] = [];
  const successes: string[] = [];
  const prompts: string[] = [];
  const copilot: {
    sendPrompt?: (prompt: string, toolNames?: string[], options?: { skillId?: string }) => Promise<void>;
    fillComposer: (prompt: string) => void;
    focusComposer: () => void;
  } = {
    sendPrompt: vi.fn(async (prompt: string) => {
      prompts.push(prompt);
    }),
    fillComposer: (prompt: string) => {
      prompts.push(prompt);
    },
    focusComposer: vi.fn(() => {}),
  };
  const api = {
    applyReviewFinding: vi.fn(async (_id: string, findingId: string, expectedVersion: number) => {
      const findings = findingId === "f1" ? [F2] : [];
      const title = findingId === "f1" ? "澄清后的单选" : "澄清后的多选";
      return detail(expectedVersion + 1, findings.length ? report({ findings, baseDraftVersion: expectedVersion + 1 }) : null, title);
    }),
    dismissReviewFinding: vi.fn(async (_id: string, findingId: string) => {
      const findings = findingId === "f1" ? [F2] : [];
      return detail(draftVersion.value, findings.length ? report({ findings }) : null);
    }),
  };
  const session = useSurveyReviewSession({
    surveyId: () => SURVEY_ID,
    canWrite: () => true,
    draftVersion: () => draftVersion.value,
    history: { current: state },
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
    },
    api,
    onApply: (next, label) => {
      commits.push({ definition: next.definition, responseLimit: next.responseLimit });
      commitLabels.push(label);
      state.value = { definition: next.definition, responseLimit: next.responseLimit };
      draftVersion.value = next.draftVersion;
    },
    onDismiss: (next) => {
      draftVersion.value = next.draftVersion;
    },
    copilot,
    notify: {
      warn: (message: string) => warns.push(message),
      error: (message: string) => errors.push(message),
      success: (message: string) => successes.push(message),
      info: () => {},
    },
    t: (key: string) => key,
  });
  return {
    session,
    api,
    commits,
    commitLabels,
    flushResults,
    flushGates,
    warns,
    errors,
    successes,
    prompts,
    copilot,
    setAutosaveStatus: (status: typeof autosaveStatus.value) => (autosaveStatus.value = status),
    setDraftVersion: (version: number) => (draftVersion.value = version),
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("useSurveyReviewSession 报告与过期", () => {
  it("只收同卷报告；plan 与 core 计划器同源", () => {
    const { session } = makeHarness();
    session.receive(report({ surveyId: "other" }));
    expect(session.report.value).toBeNull();
    const payload = report();
    session.receive(payload);
    expect(session.plan.value).toEqual(buildSurveyReviewPlan(makeDefinition(), payload.findings));
    session.discard();
    expect(session.report.value).toBeNull();
  });

  it("版本不齐或保存未落定即过期", () => {
    const { session, setDraftVersion, setAutosaveStatus } = makeHarness();
    session.receive(report());
    expect(session.stale.value).toBe(false);
    setDraftVersion(3);
    expect(session.stale.value).toBe(true);
    setDraftVersion(2);
    setAutosaveStatus("saving");
    expect(session.stale.value).toBe(true);
    setAutosaveStatus("saved");
    expect(session.stale.value).toBe(false);
  });

  it("报告带内容指纹：仅补试填记录（版本推进、指纹未变）不算过期，建议可应用", async () => {
    const { session, api, commits, setDraftVersion } = makeHarness();
    const fingerprint = await sha256Hex(canonicalContentJson(makeDefinition()));
    session.receive(report({ baseContentFingerprint: fingerprint }));
    await tick();
    // 补试填记录后版本推进，题目内容未动。
    setDraftVersion(5);
    expect(session.stale.value).toBe(false);

    await session.applyFinding("f1");
    expect(api.applyReviewFinding).toHaveBeenCalledWith(SURVEY_ID, "f1", 5);
    expect(commits).toHaveLength(1);
  });

  it("内容指纹不匹配：即使版本号一致也过期，不发应用请求", async () => {
    const { session, api, setDraftVersion } = makeHarness();
    const changed = { ...makeDefinition(), title: "别的问卷" };
    const fingerprint = await sha256Hex(canonicalContentJson(changed));
    session.receive(report({ baseContentFingerprint: fingerprint }));
    await tick();
    setDraftVersion(2);
    expect(session.stale.value).toBe(true);
    await session.applyFinding("f1");
    expect(api.applyReviewFinding).not.toHaveBeenCalled();
  });
});

describe("useSurveyReviewSession 服务端应用与忽略", () => {
  it("应用只调当前 finding，回包后留一个撤销步骤并更新剩余基线", async () => {
    const { session, api, commits, commitLabels, successes } = makeHarness();
    session.receive(report({ findings: [F1, F2] }));
    await session.applyFinding("f1");

    expect(api.applyReviewFinding).toHaveBeenCalledWith(SURVEY_ID, "f1", 2);
    expect(commits).toHaveLength(1);
    expect(commitLabels).toEqual(["筛选不充分"]);
    expect(commits[0]!.definition.questions[0]!.title).toBe("澄清后的单选");
    expect(session.report.value).toMatchObject({ baseDraftVersion: 3 });
    expect(session.report.value?.findings.map((item) => item.id)).toEqual(["f2"]);
    expect(successes).toEqual(["surveys.assistant.applied"]);
  });

  it("连续应用以最新版本调用，最后一条后清空报告", async () => {
    const { session, api, commits } = makeHarness();
    session.receive(report({ findings: [F1, F2] }));
    await session.applyFinding("f1");
    await session.applyFinding("f2");

    expect(api.applyReviewFinding).toHaveBeenNthCalledWith(2, SURVEY_ID, "f2", 3);
    expect(commits).toHaveLength(2);
    expect(session.report.value).toBeNull();
  });

  it("应用失败不产生撤销或成功提示，报告原样保留", async () => {
    const { session, api, commits, successes, warns } = makeHarness();
    api.applyReviewFinding.mockRejectedValueOnce(new SurveysApiError(409, "review_stale", null));
    session.receive(report({ findings: [F1, F2] }));
    await session.applyFinding("f1");

    expect(commits).toHaveLength(0);
    expect(successes).toHaveLength(0);
    expect(warns).toEqual(["surveys.assistant.planUnavailable"]);
    expect(session.report.value?.findings).toHaveLength(2);
    expect(session.report.value?.baseDraftVersion).toBe(2);
  });

  it("过期或无 suggestedOps 时不发请求", async () => {
    const { session, api, setDraftVersion } = makeHarness();
    session.receive(report({ findings: [{ ...F1, suggestedOps: undefined }] }));
    await session.applyFinding("f1");
    setDraftVersion(3);
    session.receive(report({ baseDraftVersion: 2 }));
    await session.applyFinding("f1");
    expect(api.applyReviewFinding).not.toHaveBeenCalled();
  });

  it("应用在途收到新报告时保留新报告，不被旧回包覆盖", async () => {
    const { session, api } = makeHarness();
    let resolve!: (value: SurveyDetail) => void;
    api.applyReviewFinding.mockImplementationOnce(
      () => new Promise<SurveyDetail>((resolvePromise) => { resolve = resolvePromise; }),
    );
    session.receive(report({ operationId: "review-op-1" }));
    const pending = session.applyFinding("f1");
    await tick();
    session.receive(report({ operationId: "review-op-2", findings: [{ ...F1, id: "f9" }] }));
    resolve(detail(3, null, "澄清后的单选"));
    await pending;
    expect(session.report.value?.operationId).toBe("review-op-2");
    expect(session.report.value?.findings.map((item) => item.id)).toEqual(["f9"]);
  });

  it("忽略经服务端移除；失败保留，最后一条后清空", async () => {
    const { session, api, warns } = makeHarness();
    session.receive(report({ findings: [F1, F2] }));
    await session.discardFinding("f1");
    expect(api.dismissReviewFinding).toHaveBeenCalledWith(SURVEY_ID, "f1");
    expect(session.report.value?.findings.map((item) => item.id)).toEqual(["f2"]);

    api.dismissReviewFinding.mockRejectedValueOnce(new SurveysApiError(500, "server", null));
    await session.discardFinding("f2");
    expect(warns).toEqual(["surveys.assistant.requestFailed"]);
    expect(session.report.value?.findings.map((item) => item.id)).toEqual(["f2"]);

    await session.discardFinding("f2");
    expect(session.report.value).toBeNull();
  });
});

describe("useSurveyReviewSession request", () => {
  it("先 flush，失败只警示不发话", async () => {
    const { session, flushResults, warns, prompts } = makeHarness();
    flushResults.push(false);
    await session.request();
    expect(warns).toEqual(["surveys.assistant.saveFirst"]);
    expect(prompts).toHaveLength(0);
    expect(session.busy.value).toBe(false);
  });

  it("flush 挂起时第二个请求被拒，不双发", async () => {
    const { session, flushResults, flushGates, prompts } = makeHarness();
    flushResults.push("wait");
    const first = session.request();
    await tick();
    await session.request();
    expect(flushGates).toHaveLength(1);
    flushGates.shift()!();
    await first;
    expect(prompts).toEqual(["surveys.assistant.reviewRequest"]);
  });

  it("sendPrompt 带 Skill 与工具白名单；失败转错误提示", async () => {
    const { session, errors, copilot, prompts } = makeHarness();
    await session.request();
    expect(prompts).toEqual(["surveys.assistant.reviewRequest"]);
    expect(copilot.sendPrompt).toHaveBeenCalledWith(
      "surveys.assistant.reviewRequest",
      ["survey_read", "survey_review"],
      { skillId: "survey-review" },
    );

    copilot.sendPrompt = vi.fn(async () => {
      throw new SurveysApiError(500, "server", null);
    });
    await session.request();
    expect(errors).toEqual(["surveys.assistant.requestFailed"]);
  });

  it("宿主没有 sendPrompt：短意图填入输入框并聚焦", async () => {
    const { session, copilot, prompts } = makeHarness();
    copilot.sendPrompt = undefined;
    await session.request();
    expect(prompts).toEqual(["surveys.assistant.reviewRequest"]);
    expect(copilot.focusComposer).toHaveBeenCalled();
  });
});
