// 问卷 AI 工具三件套与交付摘出的行为验收（issue #217，自主站迁移）：用内存
// 假 service 打桩（service 本体验收在 ../server），主站治理目录（scopes/tier/
// agent 安装）的断言留在主仓 copilot 测试。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SurveyError } from "../server/errors.js";
import { applySurveyOps, SurveyDefinitionSchema } from "../core/index.js";
import type { SurveysService } from "../server/service.js";
import type { SurveyAiContext, SurveyAiToolSpec } from "./tools.js";

import { surveyDeliveryFromResult } from "./delivery.js";
import { createSurveyAiTools, idempotentSurveyId, registerSurveyAiTools } from "./tools.js";

const SURVEY_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR: SurveyAiContext["actor"] = { userId: "user-1", space: { kind: "personal" } };
const OP_ID = "op-2f8c1a";
const SURVEY_CTX: SurveyAiContext = { actor: ACTOR, scopeSurveyId: SURVEY_ID, operationId: OP_ID };

const baseDefinition = {
  version: 1,
  title: "测试问卷",
  description: "",
  consent: "",
  questions: [
    {
      id: "q1",
      type: "single",
      title: "单选",
      required: true,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
  ],
  pages: [{ id: "p1", title: "页", questionIds: ["q1"] }],
};

const researchDesignFixture = {
  researchQuestion: "研究者如何使用 AI 辅助写作？",
  population: "高校理工科博士生",
  recruitment: "院系邮件列表",
  purpose: "describe" as const,
  timeBudgetMinutes: 8,
  constructs: [{ id: "c1", label: "使用频率", definition: "近三个月使用频率", questionIds: ["q1"] }],
  analysisPlan: "描述统计与分组交叉表",
  assumptions: ["样本同质"],
  pendingDecisions: ["是否需要按年级分层"],
};

function stubService() {
  return {
    requireSurveyAccess: vi.fn(),
    createSurvey: vi.fn(),
    updateSurvey: vi.fn(),
  } as unknown as SurveysService & {
    requireSurveyAccess: ReturnType<typeof vi.fn>;
    createSurvey: ReturnType<typeof vi.fn>;
    updateSurvey: ReturnType<typeof vi.fn>;
  };
}

let service: ReturnType<typeof stubService>;
let tools: ReturnType<typeof createSurveyAiTools>;

beforeEach(() => {
  service = stubService();
  tools = createSurveyAiTools(service);
  service.requireSurveyAccess.mockResolvedValue({
    id: SURVEY_ID,
    title: "测试问卷",
    status: "draft",
    draftVersion: 3,
    draftJson: baseDefinition,
  });
});

describe("问卷 AI 工具 — 规格面", () => {
  it("写工具都是 host-applied（服务端不落库 / 新资源直写 / 诊断只登记）", () => {
    const registered: SurveyAiToolSpec[] = [];
    registerSurveyAiTools(tools, (tool) => registered.push(tool));
    expect(registered.map((tool) => tool.name)).toEqual([
      "survey_read",
      "survey_edit",
      "survey_create",
      "survey_review",
    ]);
    for (const tool of registered) {
      if (tool.name === "survey_read") continue;
      expect(tool.hostApplied).toBe(true);
    }
    // 诊断不变更问卷：write=false（发布与改卷仍是 survey_edit 的事）。
    expect(tools.surveyReview.write).toBe(false);
    expect(tools.surveyEdit.write).toBe(true);
  });
});

describe("survey_read run", () => {
  it("返回完整定义、draftVersion 与紧凑标准索引（可定位 id）", async () => {
    const result = await tools.surveyRead.run({}, SURVEY_CTX);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("id=q1");
    expect(result.summary).toContain("页1 id=p1");
    expect(result.draftVersion).toBe(3);
    // 完整定义是权威内容：不是摘要，题目载荷原样带回。
    expect(result.definition).toEqual(baseDefinition);
    const standards = result.standards as {
      status: string;
      disclaimer: string;
      checks: { id: string; severity: string }[];
    };
    expect(standards.status).toBe("draft-agent-review");
    expect(standards.disclaimer).toContain("内部代理证据");
    expect(standards.checks.length).toBeGreaterThan(0);
    expect(standards.checks.some((check) => check.id === "wording.double_barrel")).toBe(true);
    // 没有研究设计时提示补齐，而不是替模型编一份。
    expect(String(result.researchDesignHint)).toContain("researchDesign");
    expect(service.requireSurveyAccess).toHaveBeenCalledWith("user-1", SURVEY_ID, "read");
  });

  it("按 checkIds 取标准详情；未知 id 如实回告", async () => {
    const result = await tools.surveyRead.run(
      { checkIds: ["wording.double_barrel", "wording.not_a_check"] },
      SURVEY_CTX,
    );
    const detail = result.standardsDetail as {
      checks: { id: string; claim: string; citations: unknown[] }[];
      unknownCheckIds: string[];
    };
    expect(detail.checks.map((check) => check.id)).toEqual(["wording.double_barrel"]);
    expect(detail.checks[0]!.claim.length).toBeGreaterThan(0);
    expect(detail.checks[0]!.citations.length).toBeGreaterThan(0);
    expect(detail.unknownCheckIds).toEqual(["wording.not_a_check"]);
  });

  it("有研究设计时不再给补齐提示", async () => {
    service.requireSurveyAccess.mockResolvedValue({
      id: SURVEY_ID,
      title: "测试问卷",
      status: "draft",
      draftVersion: 3,
      draftJson: { ...baseDefinition, researchDesign: researchDesignFixture },
    });
    const result = await tools.surveyRead.run({}, SURVEY_CTX);
    expect(result.researchDesignHint).toBeUndefined();
    expect((result.definition as typeof baseDefinition & { researchDesign: unknown }).researchDesign).toEqual(
      researchDesignFixture,
    );
  });

  it("非 survey 会话给出引导性错误，不查库", async () => {
    const result = await tools.surveyRead.run({}, { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID });
    expect(result.error).toContain("问卷工作台");
    expect(service.requireSurveyAccess).not.toHaveBeenCalled();
  });
});

describe("survey_edit run", () => {
  it("合法 ops：应用（含生成 id）并回执，不写库", async () => {
    const result = await tools.surveyEdit.run(
      {
        baseDraftVersion: 3,
        ops: [
          {
            op: "add_question",
            pageId: "p1",
            question: { type: "nps", title: "推荐意愿", required: false },
          },
        ],
        summary: "加一道 NPS",
      },
      SURVEY_CTX,
    );
    expect(service.updateSurvey).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.operationId).toBe(OP_ID);
    expect(result.baseDraftVersion).toBe(3);
    expect(result.appliedCount).toBe(1);
    const added = (result.appliedOps as unknown[])[0] as unknown as { question: { id: string } };
    expect(added.question.id).toBeTruthy();
  });

  it("基线落后于服务端版本（读取后用户保存过）：拒绝并要求重读，不产生交付", async () => {
    const result = await tools.surveyEdit.run(
      {
        baseDraftVersion: 2,
        ops: [{ op: "set_meta", title: "AI 基于 v2 的标题" }],
        summary: "改标题",
      },
      SURVEY_CTX,
    );
    expect(result.ok).toBeUndefined();
    expect(String(result.error)).toContain("stale_read");
    expect(result.currentDraftVersion).toBe(3);
    // 不新鲜就不应用任何操作——旧读结果不能经服务端盖章覆盖人工编辑。
    expect(surveyDeliveryFromResult("survey_edit", result)).toBeNull();
  });

  it("缺 baseDraftVersion：给出引导性错误，不查库", async () => {
    const result = await tools.surveyEdit.run(
      { ops: [{ op: "set_meta", title: "x" }], summary: "改名" },
      SURVEY_CTX,
    );
    expect(String(result.error)).toContain("baseDraftVersion");
    expect(service.requireSurveyAccess).not.toHaveBeenCalled();
  });

  it("全部被拒：错误回执带原因与 hint，模型可自愈", async () => {
    const result = await tools.surveyEdit.run(
      {
        baseDraftVersion: 3,
        ops: [{ op: "update_question", questionId: "ghost", patch: { title: "x" } }],
        summary: "改题",
      },
      SURVEY_CTX,
    );
    expect(result.error).toContain("全部操作被拒绝");
    const rejected = result.rejected as { reason: string }[];
    expect(rejected[0]!.reason).toContain("ghost");
  });

  it("无写权限给出明确错误", async () => {
    service.requireSurveyAccess.mockRejectedValueOnce(new SurveyError("forbidden", 403));
    const result = await tools.surveyEdit.run(
      { baseDraftVersion: 3, ops: [{ op: "set_meta", title: "x" }], summary: "改名" },
      SURVEY_CTX,
    );
    expect(result.error).toContain("写权限");
  });
});

describe("survey_create run", () => {
  it("建行 + 存草稿定义，返回 surveyId；语义 issue 只报告不阻断", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const definition = JSON.parse(JSON.stringify(baseDefinition)) as typeof baseDefinition;
    definition.pages.push({ id: "p2", title: "空页", questionIds: [] });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.surveyId).toBe(SURVEY_ID);
    expect(service.createSurvey).toHaveBeenCalledWith(ACTOR, {
      title: "新问卷",
      idempotentSurveyId: idempotentSurveyId("user-1", OP_ID),
    });
    expect(service.updateSurvey).toHaveBeenCalledWith("user-1", SURVEY_ID, {
      expectedVersion: 1,
      definition: expect.objectContaining({ title: "新问卷" }),
    });
    expect(result.issues).toEqual([{ path: "pages.1.questionIds", code: "empty_page", message: "页至少包含一道题" }]);
  });

  it("重试落在已存草稿的问卷（版本>1）：跳过重复写草稿，同一 surveyId", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 2 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: JSON.parse(JSON.stringify(baseDefinition)) },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.surveyId).toBe(SURVEY_ID);
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("同 (userId, operationId) 恒派生同一幂等 surveyId，跨用户不同", () => {
    const a = idempotentSurveyId("user-1", OP_ID);
    expect(idempotentSurveyId("user-1", OP_ID)).toBe(a);
    expect(idempotentSurveyId("user-2", OP_ID)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("definition 形状不合法：结构化错误 + 题型词表 hint", async () => {
    const result = await tools.surveyCreate.run(
      { title: "x", definition: { version: 1 } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.error).toContain("definition 形状不合法");
    expect(result.hint).toContain("matrix_single");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
});

describe("surveyDeliveryFromResult", () => {
  it("survey_edit 成功结果摘出交付载荷；失败与非问卷工具返回 null", () => {
    const delivery = surveyDeliveryFromResult("survey_edit", {
      ok: true,
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      baseDraftVersion: 3,
      summary: "改题",
      appliedOps: [{ op: "set_meta", title: "x" }],
      rejected: [{ reason: "r" }],
      issues: [{ path: "p", code: "empty_page", message: "m" }],
    });
    expect(delivery).toMatchObject({
      type: "survey_edit",
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      baseDraftVersion: 3,
      summary: "改题",
    });

    expect(surveyDeliveryFromResult("survey_edit", { ok: false, error: "x" })).toBeNull();
    expect(surveyDeliveryFromResult("search_library", { ok: true })).toBeNull();
    expect(
      surveyDeliveryFromResult("survey_edit", { ok: true, surveyId: SURVEY_ID, appliedOps: [] }),
    ).toBeNull();
  });

  it("survey_create 摘出 { surveyId, title, operationId }", () => {
    const delivery = surveyDeliveryFromResult("survey_create", {
      ok: true,
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      title: "新问卷",
      issues: [],
    });
    expect(delivery).toMatchObject({
      type: "survey_create",
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      title: "新问卷",
    });
  });

  it("缺操作身份或校验基线的结果不进交付面", () => {
    expect(
      surveyDeliveryFromResult("survey_edit", {
        ok: true,
        surveyId: SURVEY_ID,
        baseDraftVersion: 3,
        appliedOps: [{ op: "set_meta", title: "x" }],
      }),
    ).toBeNull();
    expect(
      surveyDeliveryFromResult("survey_edit", {
        ok: true,
        surveyId: SURVEY_ID,
        operationId: OP_ID,
        appliedOps: [{ op: "set_meta", title: "x" }],
      }),
    ).toBeNull();
    expect(
      surveyDeliveryFromResult("survey_create", { ok: true, surveyId: SURVEY_ID, title: "x" }),
    ).toBeNull();
  });
});

describe("survey_review run", () => {
  const finding = {
    id: "f1",
    checkId: "wording.double_barrel",
    questionId: "q1",
    title: "双重提问",
    severity: "major" as const,
    reason: "题干同时问了两个概念",
    recommendation: "拆成两题",
  };

  it("建议里的自动生成 id 随交付固定，重放不会生成另一套身份", async () => {
    const result = await tools.surveyReview.run({
      baseDraftVersion: 3, summary: "补充题目", findings: [{
        ...finding,
        suggestedOps: [{ op: "add_question", pageId: "p1", question: { type: "text", title: "补充意见", required: false } }],
      }],
    }, SURVEY_CTX);
    expect(result.ok).toBe(true);
    const [{ suggestedOps }] = result.findings as Array<{ suggestedOps: unknown[] }>;
    const original = SurveyDefinitionSchema.parse(baseDefinition);
    const first = applySurveyOps(original, suggestedOps);
    const second = applySurveyOps(original, suggestedOps);
    expect(first.rejected).toEqual([]);
    expect(first.definition.questions.at(-1)!.id).toBe(second.definition.questions.at(-1)!.id);
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("登记诊断：回执带 operationId/基线/findings，不写库、不改卷", async () => {
    const result = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "覆盖基本齐全，一处措辞需拆分", findings: [finding] },
      SURVEY_CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.surveyId).toBe(SURVEY_ID);
    expect(result.operationId).toBe(OP_ID);
    expect(result.baseDraftVersion).toBe(3);
    expect((result.findings as unknown[])[0]).toMatchObject({ id: "f1", severity: "major" });
    expect(String(result.note)).toContain("内部代理证据");
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("目录外发现仍保留，不伪造标准依据", async () => {
    const { checkId, ...outside } = finding;
    const result = await tools.surveyReview.run({ baseDraftVersion: 3, summary: "目录外风险待核验", findings: [outside] }, SURVEY_CTX);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([outside]);
  });

  it("零发现是合法结论（findings 空数组），但不等于已验证", async () => {
    const result = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "未发现需要修改的问题；仍建议做认知访谈", findings: [] },
      SURVEY_CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("基线过期：stale_read，不产生诊断交付", async () => {
    const result = await tools.surveyReview.run(
      { baseDraftVersion: 2, summary: "诊断", findings: [finding] },
      SURVEY_CTX,
    );
    expect(result.ok).toBeUndefined();
    expect(String(result.error)).toContain("stale_read");
    expect(result.currentDraftVersion).toBe(3);
    expect(surveyDeliveryFromResult("survey_review", result)).toBeNull();
  });

  it("未知 checkId / 未知 questionId 被拒，不静默登记", async () => {
    const unknownCheck = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "诊断", findings: [{ ...finding, checkId: "wording.invented" }] },
      SURVEY_CTX,
    );
    expect(String(unknownCheck.error)).toContain("未知 checkId");

    const unknownQuestion = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "诊断", findings: [{ ...finding, questionId: "ghost" }] },
      SURVEY_CTX,
    );
    expect(String(unknownQuestion.error)).toContain("不存在的题目");
    expect(unknownQuestion.unknownQuestions).toEqual([{ findingId: "f1", questionId: "ghost" }]);
  });

  it("suggestedOps 全部可应用才登记；replace_all 与不可应用操作被拒", async () => {
    const applied = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "拆题",
        findings: [
          {
            ...finding,
            suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "你最近一次使用 AI 是做什么？" } }],
          },
        ],
      },
      SURVEY_CTX,
    );
    expect(applied.ok).toBe(true);

    const ghost = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "改题",
        findings: [
          { ...finding, suggestedOps: [{ op: "update_question", questionId: "ghost", patch: { title: "x" } }] },
        ],
      },
      SURVEY_CTX,
    );
    expect(String(ghost.error)).toContain("未通过可应用性校验");

    const replace = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "整卷替换",
        findings: [{ ...finding, suggestedOps: [{ op: "replace_all", definition: baseDefinition }] }],
      },
      SURVEY_CTX,
    );
    expect(String(replace.error)).toContain("未通过可应用性校验");
  });

  it("发布类操作不是合法 op：形状校验直接拒绝", async () => {
    const result = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "发布",
        findings: [
          { ...finding, suggestedOps: [{ op: "publish" }] },
        ],
      },
      SURVEY_CTX,
    );
    expect(String(result.error)).toContain("findings 形状不合法");
  });

  it("缺 summary / 条数超限 / 重复 id 给出可自愈错误", async () => {
    const noSummary = await tools.surveyReview.run({ baseDraftVersion: 3, findings: [] }, SURVEY_CTX);
    expect(String(noSummary.error)).toContain("summary");

    const tooMany = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "批量",
        findings: Array.from({ length: 21 }, (_, i) => ({ ...finding, id: `f${i}` })),
      },
      SURVEY_CTX,
    );
    expect(String(tooMany.error)).toContain("上限");

    const duplicate = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "重复", findings: [finding, { ...finding }] },
      SURVEY_CTX,
    );
    expect(String(duplicate.error)).toContain("重复");
  });
});

describe("surveyDeliveryFromResult — survey_review", () => {
  it("摘出诊断帧（含基线、summary、findings）", () => {
    const delivery = surveyDeliveryFromResult("survey_review", {
      ok: true,
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      baseDraftVersion: 3,
      summary: "两处需修订",
      findings: [
        {
          id: "f1",
          checkId: "wording.double_barrel",
          title: "双重提问",
          severity: "major",
          reason: "r",
          recommendation: "c",
        },
      ],
    });
    expect(delivery).toMatchObject({
      type: "survey_review",
      surveyId: SURVEY_ID,
      operationId: OP_ID,
      baseDraftVersion: 3,
      summary: "两处需修订",
    });
    expect((delivery as { findings: unknown[] }).findings).toHaveLength(1);
  });

  it("失败结果、缺基线或缺 operationId 不进交付面", () => {
    expect(surveyDeliveryFromResult("survey_review", { ok: false, error: "x" })).toBeNull();
    expect(
      surveyDeliveryFromResult("survey_review", {
        ok: true,
        surveyId: SURVEY_ID,
        baseDraftVersion: 3,
        summary: "s",
        findings: [],
      }),
    ).toBeNull();
    expect(
      surveyDeliveryFromResult("survey_review", {
        ok: true,
        surveyId: SURVEY_ID,
        operationId: OP_ID,
        summary: "s",
        findings: [],
      }),
    ).toBeNull();
  });
});
