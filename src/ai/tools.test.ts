// 问卷 AI 工具三件套与交付摘出的行为验收（issue #217，自主站迁移）：用内存
// 假 service 打桩（service 本体验收在 ../server），主站治理目录（scopes/tier/
// agent 安装）的断言留在主仓 copilot 测试。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { SurveyError } from "../server/errors.js";
import { applySurveyOps, canonicalContentJson, canonicalSurveyJson, SurveyDefinitionSchema } from "../core/index.js";
import type { SurveysService } from "../server/service.js";
import type { SurveyAiContext, SurveyAiToolSpec } from "./tools.js";

import { surveyDeliveryFromResult } from "./delivery.js";
import {
  createSurveyAiTools,
  idempotentSurveyId,
  QUESTION_PAYLOAD_HINT,
  registerSurveyAiTools,
} from "./tools.js";

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
  researchDesign: { researchQuestion: "了解情况", population: "", recruitment: "", constructs: [{ id: "c1", label: "情况", definition: "情况", questionIds: ["q1"] }], analysisPlan: "描述", assumptions: [], pendingDecisions: [] },
};

function definitionWithQuestions(count: number) {
  const questions = Array.from({ length: count }, (_, index) => ({
    id: `q${index + 1}`,
    type: "text" as const,
    title: `第 ${index + 1} 题`,
    required: false,
  }));
  return {
    version: 1 as const,
    title: "题数约束问卷",
    description: "",
    consent: "",
    questions,
    pages: [{ id: "p1", title: "页", questionIds: questions.map((question) => question.id) }],
    researchDesign: { researchQuestion: "了解情况", population: "", recruitment: "", constructs: [{ id: "c1", label: "情况", definition: "情况", questionIds: questions.map((question) => question.id) }], analysisPlan: "描述", assumptions: [], pendingDecisions: [] },
  };
}

const researchDesignFixture = {
  researchQuestion: "研究者如何使用 AI 辅助写作？",
  population: "高校理工科博士生",
  recruitment: "院系邮件列表",
  purpose: "describe" as const,
  timeBudgetMinutes: 8,
  constructs: [{ id: "c1", label: "使用频率", definition: "使用频率", questionIds: ["q1"] }],
  analysisPlan: "描述统计与分组交叉表",
  assumptions: ["样本同质"],
  pendingDecisions: ["是否需要按年级分层"],
};

function stubService() {
  return {
    requireSurveyAccess: vi.fn(),
    createSurvey: vi.fn(),
    updateSurvey: vi.fn(),
    recordReview: vi.fn(),
  } as unknown as SurveysService & {
    requireSurveyAccess: ReturnType<typeof vi.fn>;
    createSurvey: ReturnType<typeof vi.fn>;
    updateSurvey: ReturnType<typeof vi.fn>;
    recordReview: ReturnType<typeof vi.fn>;
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
  it("写工具都是 host-applied（编辑不落库 / 新资源直写 / 诊断保存建议）", () => {
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

  it("量表载荷提示词硬约束：两端锚点必填且语义对称（P1-8a）", () => {
    expect(QUESTION_PAYLOAD_HINT).toContain("两端锚点必填且语义对称");
    expect(QUESTION_PAYLOAD_HINT).toContain("1=毫无提升/7=非常有提升");
    expect(QUESTION_PAYLOAD_HINT).toContain("只写一端或两端不对称");
  });
});

describe("survey_read run", () => {
  it("将频率线索作为待核对提示交给模型，而不是登记诊断", async () => {
    const frequencyQuestion = { ...baseDefinition.questions[0]!, title: "你使用工具的频率？", options: [{ id: "a", label: "每周一次" }, { id: "b", label: "经常" }] };
    service.requireSurveyAccess.mockResolvedValue({ id: SURVEY_ID, status: "draft", draftVersion: 3,
      draftJson: { ...baseDefinition, questions: [frequencyQuestion] } });
    const result = await tools.surveyRead.run({}, SURVEY_CTX);
    expect(result.reviewSignals).toMatchObject([{ questionId: "q1", kind: "recall_period" }, { questionId: "q1", kind: "frequency_anchors" }]);
    expect(String(result.reviewSignalsNote)).toContain("不是缺陷结论");
    expect(service.recordReview).not.toHaveBeenCalled();
  });
  it("返回来源的实际题目变化状态，不把记录当作有效性认证", async () => {
    const baseline = canonicalSurveyJson(baseDefinition.questions[0]);
    service.requireSurveyAccess.mockResolvedValue({ id: SURVEY_ID, status: "draft", draftVersion: 3,
      draftJson: { ...baseDefinition, questions: [{ ...baseDefinition.questions[0], title: "已修改" }],
        sourceRecords: [{ sourceId: "sus-brooke-1996", questionId: "q1", language: "zh-CN", baselineQuestion: baseline }] } });
    const result = await tools.surveyRead.run({}, SURVEY_CTX);
    expect(result.sourceContext).toMatchObject([{ questionId: "q1", state: "modified", source: { name: "System Usability Scale (SUS)" } }]);
    expect(JSON.stringify(result.sourceContext)).toContain("不证明原版");
    expect(result.definition).not.toHaveProperty("sourceRecords");
    expect(JSON.stringify(result)).not.toContain(baseline);
  });
  it("只有显式选择反馈审查才读取试填反馈，默认不把反馈发给模型", async () => {
    const list = vi.fn(async () => [{
      id: "p1", draftVersion: 3,
      contentFingerprint: createHash("sha256").update(canonicalContentJson(baseDefinition)).digest("hex"),
      expiresAt: "2030-01-01T00:00:00.000Z", questions: [{ id: "q1", title: "单选" }],
      submissions: [{ id: "s1", completedAt: "2026-10-28T00:00:00.000Z", feedback: [{ questionId: "q1", aspect: "general" as const, note: "选项含糊" }] }],
    }]);
    const withPretest = createSurveyAiTools(service, { list } as never);
    const ordinary = await withPretest.surveyRead.run({}, SURVEY_CTX);
    expect(ordinary.pretestFeedback).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    const requested = await withPretest.surveyRead.run({}, { ...SURVEY_CTX, includePretestFeedback: true });
    expect(requested.pretestFeedback).toMatchObject({ entries: [{ questionId: "q1", note: "选项含糊", currentContent: true }], omitted: 0 });
    expect(requested.pretestFeedback).not.toHaveProperty("answers");
  });
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
    expect(service.requireSurveyAccess).toHaveBeenCalledWith("user-1", SURVEY_ID, "read");
  });

  it("读取旧草稿时提示补齐缺失的研究设计", async () => {
    const { researchDesign: _design, ...legacy } = baseDefinition;
    service.requireSurveyAccess.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 3, draftJson: legacy });
    const result = await tools.surveyRead.run({}, SURVEY_CTX);
    expect(String(result.researchDesignHint)).toContain("researchDesign");
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

it("AI 整卷替换不能伪造或覆盖来源记录", async () => {
  const result = await tools.surveyEdit.run({ baseDraftVersion: 3, summary: "重建", ops: [{ op: "replace_all", definition: { ...baseDefinition, sourceRecords: [] } }] }, SURVEY_CTX);
  expect(result.error).toContain("不能自行写入");
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

  it("来源快照已满时不交付无法完整记录来源的新增题", async () => {
    service.requireSurveyAccess.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 3, draftJson: { ...baseDefinition,
      sourceRecords: Array.from({ length: 50 }, (_, index) => ({ sourceId: "old", questionId: `old${index}`, language: "und", baselineQuestion: "{}" })) } });
    const result = await tools.surveyEdit.run({ baseDraftVersion: 3, summary: "补题",
      ops: [{ op: "add_question", pageId: "p1", question: { id: "new", type: "text", title: "新增", required: false } }] }, SURVEY_CTX);
    expect(String(result.error)).toContain("来源记录已满");
    expect(result.ok).not.toBe(true);
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
  it("没有年级题时不能把年级分组写成可执行计划", async () => {
    const definition = { ...baseDefinition, researchDesign: { ...baseDefinition.researchDesign, analysisPlan: "按年级分组比较" } };
    const result = await tools.surveyCreate.run({ title: "调查", definition }, { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID });
    expect(result.missingGroup).toBe("年级");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
  it("研究问题或分析计划缺失时不交付缺少用途的草稿", async () => {
    for (const researchDesign of [undefined, { ...baseDefinition.researchDesign, researchQuestion: "" }, { ...baseDefinition.researchDesign, analysisPlan: "" }]) {
      const result = await tools.surveyCreate.run({ title: "调查", definition: { ...baseDefinition, researchDesign } }, { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID });
      expect(String(result.error)).toContain("研究问题和预期分析");
    }
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
  it("不创建与填写前同意重复且无法兑现拒绝退出的题目", async () => {
    const base = definitionWithQuestions(1);
    const definition = { ...base, questions: [{ id: "q1", type: "single", title: "是否同意参与本次研究？", required: true,
      options: [{ id: "yes", label: "同意" }, { id: "no", label: "不同意（问卷结束）" }] }] };
    const result = await tools.surveyCreate.run({ title: "调查", definition }, { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID });
    expect(String(result.error)).toContain("参与同意题");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
  it("不把未经用户确认的匿名承诺写入参与说明", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, consent: "数据匿名汇总。" } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["不收集姓名"] },
    );
    expect(service.updateSurvey.mock.calls[0]![2].definition.consent).toBe("");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "consent_unverified_data_handling" })]));
  });
  it("由系统记录 AI 建卷题目及原始内容，但不声称来源或许可已核验", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: baseDefinition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    const saved = service.updateSurvey.mock.calls[0]![2].definition;
    expect(saved.sourceRecords).toEqual([{ sourceId: "ai-generated-unverified", questionId: "q1", language: "und", baselineQuestion: canonicalSurveyJson(saved.questions[0]) }]);
  });
  it("不接受模型自行声明来源记录", async () => {
    const result = await tools.surveyCreate.run({ title: "测试", definition: { ...baseDefinition, sourceRecords: [{ sourceId: "sus-brooke-1996" }] } }, SURVEY_CTX);
    expect(result.error).toContain("不能自行声明");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
  it("结构问题在建卷前返回给模型修复，修复后只创建一次", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const definition = JSON.parse(JSON.stringify(baseDefinition)) as typeof baseDefinition;
    definition.pages.push({ id: "p2", title: "空页", questionIds: [] });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.error).toContain("未创建问卷");
    expect(result.issues).toEqual([{ path: "pages.1.questionIds", code: "empty_page", message: "页至少包含一道题" }]);
    expect(service.createSurvey).not.toHaveBeenCalled();
    const repaired = await tools.surveyCreate.run(
      { title: "新问卷", definition: baseDefinition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(repaired.ok).toBe(true);
    expect(repaired.surveyId).toBe(SURVEY_ID);
    expect(service.createSurvey).toHaveBeenCalledWith(ACTOR, {
      title: "新问卷",
      idempotentSurveyId: idempotentSurveyId("user-1", OP_ID),
    });
    expect(service.updateSurvey).toHaveBeenCalledWith("user-1", SURVEY_ID, {
      expectedVersion: 1,
      definition: expect.objectContaining({ title: "新问卷" }),
    });
  });

  it("没有可答题的生成结果不创建问卷", async () => {
    const result = await tools.surveyCreate.run(
      { title: "空问卷", definition: { ...baseDefinition, questions: [], pages: [], researchDesign: { ...baseDefinition.researchDesign, constructs: [] } } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.error).toContain("未创建问卷");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });

  it("研究设计中未覆盖的维度作为提醒，不阻断草稿", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, researchDesign: { ...researchDesignFixture, constructs: [...researchDesignFixture.constructs, { id: "empty", label: "未覆盖", definition: "未知", questionIds: [] }] } } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "design_construct_unmapped" })]));
  });

  it("生成结果中未映射用途的题目要求模型补全后再保存", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, researchDesign: { ...researchDesignFixture, constructs: [] } } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.error).toContain("未创建");
    expect(result.unmappedQuestionIds).toEqual(["q1"]);
    expect(service.createSurvey).not.toHaveBeenCalled();
  });
  it("未经确认的研究期限和机构不创建问卷", async () => {
    const result = await tools.surveyCreate.run({ title: "调查", definition: { ...baseDefinition,
      questions: [{ ...baseDefinition.questions[0], title: "过去半年使用情况" }],
      researchDesign: { ...researchDesignFixture, population: "华中师范大学学生" } } },
    { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["调查我们组现在的情况"] });
    expect(result.error).toContain("未经用户确认");
    expect(result.unsupportedPeriod).toBe("过去半年");
    expect(result.unsupportedInstitution).toContain("华中师范大学");
    expect(service.createSurvey).not.toHaveBeenCalled();
  });

  it("用途和时间未知时不强迫模型编造，原样保存未决设计", async () => {
    const { purpose: _purpose, timeBudgetMinutes: _time, ...unknownDesign } = researchDesignFixture;
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, researchDesign: unknownDesign } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    const saved = service.updateSurvey.mock.calls[0]![2].definition;
    expect(saved.researchDesign).not.toHaveProperty("purpose");
    expect(saved.researchDesign).not.toHaveProperty("timeBudgetMinutes");
  });

  it("模型自行填写的时长限制不作为用户约束保存", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, researchDesign: researchDesignFixture } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["调查过去8分钟的活动"] },
    );
    expect(service.updateSurvey.mock.calls[0]![2].definition.researchDesign).not.toHaveProperty("timeBudgetMinutes");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "design_unverified_time_budget" })]));
  });

  it("用户明确给出的填写时长限制仍然保留", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    await tools.surveyCreate.run(
      { title: "新问卷", definition: { ...baseDefinition, researchDesign: researchDesignFixture } },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["请控制在8分钟内完成"] },
    );
    expect(service.updateSurvey.mock.calls[0]![2].definition.researchDesign.timeBudgetMinutes).toBe(8);
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

  it("明确题数且定义匹配：照常创建", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "八题问卷", expectedQuestionCount: 8, definition: definitionWithQuestions(8) },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.questionCount).toBe(8);
    expect(service.createSurvey).toHaveBeenCalledTimes(1);
  });

  it("少于明确题数：建卷前拒绝并给实际题数，不调用 service", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "八题问卷", expectedQuestionCount: 8, definition: definitionWithQuestions(5) },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBeUndefined();
    expect(String(result.error)).toContain("题数不符");
    expect(String(result.error)).toContain("只有 5 题");
    expect(result.expectedQuestionCount).toBe(8);
    expect(result.actualQuestionCount).toBe(5);
    expect(String(result.hint)).toContain("重试");
    expect(service.createSurvey).not.toHaveBeenCalled();
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("多于明确题数：同样在建卷前拒绝", async () => {
    const result = await tools.surveyCreate.run(
      { title: "八题问卷", expectedQuestionCount: 8, definition: definitionWithQuestions(9) },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(String(result.error)).toContain("题数不符");
    expect(result.actualQuestionCount).toBe(9);
    expect(service.createSurvey).not.toHaveBeenCalled();
  });

  it("未声明题数不设限：不做任何题数硬编码", async () => {
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const result = await tools.surveyCreate.run(
      { title: "五题问卷", definition: definitionWithQuestions(5) },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.questionCount).toBe(5);
  });

  it("说明块不是题目：不计入明确题数", async () => {
    const base = definitionWithQuestions(3);
    const definition = {
      ...base,
      questions: [
        ...base.questions,
        { id: "s1", type: "statement", title: "", required: false, body: "以下问题请按最近三个月作答。" },
      ],
      pages: [{ id: "p1", title: "页", questionIds: ["q1", "q2", "q3", "s1"] }],
    };
    service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const matched = await tools.surveyCreate.run(
      { title: "三题问卷", expectedQuestionCount: 3, definition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["最近三个月"] },
    );
    expect(matched.ok).toBe(true);
    expect(matched.questionCount).toBe(3);

    const mismatched = await tools.surveyCreate.run(
      { title: "四题问卷", expectedQuestionCount: 4, definition },
      { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID, userTexts: ["最近三个月"] },
    );
    expect(String(mismatched.error)).toContain("题数不符");
    expect(mismatched.actualQuestionCount).toBe(3);
  });

  it("expectedQuestionCount 非法（0 / 字符串 / 超上限）：错误可自愈，不建卷", async () => {
    for (const expectedQuestionCount of [0, "8", 51]) {
      const result = await tools.surveyCreate.run(
        { title: "x", expectedQuestionCount, definition: definitionWithQuestions(1) },
        { actor: ACTOR, scopeSurveyId: null, operationId: OP_ID },
      );
      expect(String(result.error)).toContain("expectedQuestionCount");
    }
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

  it("试填反馈审查不把未经核实的提交者身份当作真人证据", async () => {
    tools = createSurveyAiTools(service, { list: vi.fn(async () => [{ submissions: [{ feedback: [{ questionId: "q1", aspect: "general", note: "不清楚" }] }] }]) } as never);
    const result = await tools.surveyReview.run({
      baseDraftVersion: 3,
      summary: "收到真人试填反馈",
      findings: [finding],
    }, { ...SURVEY_CTX, includePretestFeedback: true });
    expect(result.error).toContain("不能证明提交者的身份");
    expect(service.recordReview).not.toHaveBeenCalled();
    const corrected = await tools.surveyReview.run({
      baseDraftVersion: 3,
      summary: "收到试填反馈，尚未证明真人验证",
      findings: [finding],
    }, { ...SURVEY_CTX, includePretestFeedback: true });
    expect(corrected.ok).toBe(true);
  });

  it("没有试填反馈时不登记或覆盖建议", async () => {
    tools = createSurveyAiTools(service, { list: vi.fn(async () => []) } as never);
    const result = await tools.surveyReview.run({ baseDraftVersion: 3, summary: "诊断", findings: [finding] }, { ...SURVEY_CTX, includePretestFeedback: true });
    expect(result.error).toContain("没有题目级试填反馈");
    expect(service.recordReview).not.toHaveBeenCalled();
  });

  it("未知回忆期或占位文本不作为可应用修订；已有时间口径可保留", async () => {
    const makeFinding = (title: string) => ({
      ...finding, suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title } }],
    });
    const unknown = await tools.surveyReview.run({ baseDraftVersion: 3, summary: "补充时间", findings: [makeFinding("过去一个月你使用过吗？")] }, SURVEY_CTX);
    expect(unknown.strippedOps).toEqual(["f1"]);
    expect((unknown.findings as Array<{ recommendation: string }>)[0]?.recommendation).toContain("先确定");
    const placeholder = await tools.surveyReview.run({ baseDraftVersion: 3, summary: "补全题目", findings: [makeFinding("问题 1（请在此处补全完整题干表述）")] }, SURVEY_CTX);
    expect(placeholder.strippedOps).toEqual(["f1"]);
    service.requireSurveyAccess.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 3, draftJson: { ...baseDefinition, description: "本调查关注过去一个月的使用情况。" } });
    const known = await tools.surveyReview.run({ baseDraftVersion: 3, summary: "统一时间", findings: [makeFinding("过去一个月你使用过吗？")] }, SURVEY_CTX);
    expect((known.findings as Array<{ suggestedOps?: unknown[] }>)[0]?.suggestedOps).toHaveLength(1);
  });

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

  it("登记诊断：回执带 operationId/基线/findings，保存报告但不改卷", async () => {
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
    expect(String(result.note)).toContain("可自动修订的建议须经用户确认后应用");
    expect(String(result.note)).toContain("引导用户查看画布");
    expect(String(result.note)).not.toContain("用户确认后才在画布生效");
    expect(service.recordReview).toHaveBeenCalledWith("user-1", SURVEY_ID, {
      operationId: OP_ID,
      baseDraftVersion: 3,
      summary: "覆盖基本齐全，一处措辞需拆分",
      findings: [finding],
    });
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("保留题目修订，同时将说明与同意条款修改转为人工核对", async () => {
    const findings = [
      {
        id: "f1",
        checkId: "research_goal.vague_objective",
        questionId: "q1",
        title: "目标模糊",
        severity: "major" as const,
        reason: "r1",
        recommendation: "c1",
        suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "你最近一次使用 AI 做什么？" } }],
      },
      {
        id: "f2",
        checkId: "sampling_recruitment.channel_bias",
        title: "渠道偏差",
        severity: "minor" as const,
        reason: "r2",
        recommendation: "c2",
        suggestedOps: [{ op: "set_meta", description: "样本来自院系邮件列表，存在覆盖偏差。" }],
      },
      {
        id: "f3",
        checkId: "burden.total_questions",
        title: "题量偏多",
        severity: "minor" as const,
        reason: "r3",
        recommendation: "c3",
        suggestedOps: [{ op: "set_meta", consent: "本次调查约 5 分钟，可随时退出。" }],
      },
    ];
    const result = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "三组修订", findings },
      SURVEY_CTX,
    );
    expect(result.ok).toBe(true);
    const returned = result.findings as Array<{ id: string; suggestedOps?: unknown[] }>;
    expect(returned.map((item) => item.id)).toEqual(["f1", "f2", "f3"]);
    expect(returned[0]?.suggestedOps).toHaveLength(1);
    expect(returned[1]?.suggestedOps).toBeUndefined();
    expect(returned[2]?.suggestedOps).toBeUndefined();
    expect(result.strippedOps).toEqual(["f2", "f3"]);
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

  it("未知 checkId / 未知 questionId 被剥离而非整份拒绝（P0 宽容归一化）", async () => {
    const unknownCheck = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "诊断", findings: [{ ...finding, checkId: "wording.invented" }] },
      SURVEY_CTX,
    );
    expect(unknownCheck.ok).toBe(true);
    expect((unknownCheck.findings as Array<{ checkId?: string }>)[0]).not.toHaveProperty("checkId");
    expect(unknownCheck.strippedCheckIds).toEqual(["wording.invented"]);
    expect(String(unknownCheck.note)).toContain("目录外发现");
    expect(service.recordReview).toHaveBeenCalledTimes(1);

    const unknownQuestion = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "诊断", findings: [{ ...finding, questionId: "ghost" }] },
      SURVEY_CTX,
    );
    expect(unknownQuestion.ok).toBe(true);
    const finding0 = (unknownQuestion.findings as Array<{ questionId?: string }>)[0]!;
    expect(finding0.questionId).toBeUndefined();
    expect(unknownQuestion.reanchoredQuestions).toEqual([{ findingId: "f1", questionId: "ghost" }]);
  });

  it("标明整卷的问题不错误挂在具体题目旁", async () => {
    const result = await tools.surveyReview.run({
      baseDraftVersion: 3, summary: "研究目标", findings: [{ ...finding, title: "研究目标待确认（整卷）" }],
    }, SURVEY_CTX);
    expect(result.ok).toBe(true);
    expect((result.findings as Array<{ questionId?: string }>)[0]).not.toHaveProperty("questionId");
  });

  it("suggestedOps 可应用则保留；replace_all 与不可应用操作剥成人工待办", async () => {
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
    expect((applied.findings as Array<{ suggestedOps?: unknown }>)[0]!.suggestedOps).toHaveLength(1);

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
    expect(ghost.ok).toBe(true);
    expect((ghost.findings as Array<{ suggestedOps?: unknown }>)[0]).not.toHaveProperty("suggestedOps");
    expect(ghost.strippedOps).toEqual(["f1"]);
    // 诊断本体保留：reason/recommendation 不丢。
    expect((ghost.findings as Array<{ reason: string }>)[0]!.reason).toBe(finding.reason);

    const replace = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "整卷替换",
        findings: [{ ...finding, suggestedOps: [{ op: "replace_all", definition: baseDefinition }] }],
      },
      SURVEY_CTX,
    );
    expect(replace.ok).toBe(true);
    expect(replace.strippedOps).toEqual(["f1"]);
  });

  it("发布类操作不是合法 op：剥掉 suggestedOps 保留诊断，不整份拒绝", async () => {
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
    expect(result.ok).toBe(true);
    expect((result.findings as Array<{ suggestedOps?: unknown }>)[0]).not.toHaveProperty("suggestedOps");
    expect(String(result.note)).toContain("人工待办");
  });

  it("格式不完整时整份报告不登记，修复后仍能归一化有效条目", async () => {
    const messy = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "混合",
        findings: [
          { ...finding, title: "  双重提问  ", severity: "MAJOR" },
          { ...finding }, // id 与第一条重复 → 服务端补造新 id
          { id: "f9", title: "", severity: "major", reason: "r", recommendation: "c" }, // 空 title → 只丢这条
        ],
      },
      SURVEY_CTX,
    );
    expect(messy.error).toContain("整份报告未登记");
    expect(messy.invalid).toEqual([{ index: 2, reason: expect.stringContaining("必填") }]);
    expect(service.recordReview).not.toHaveBeenCalled();
    const repaired = await tools.surveyReview.run({
      baseDraftVersion: 3, summary: "混合", findings: [
        { ...finding, title: "  双重提问  ", severity: "MAJOR" },
        { ...finding },
      ],
    }, SURVEY_CTX);
    expect(repaired.ok).toBe(true);
    const registered = repaired.findings as Array<{ id: string; title: string; severity: string }>;
    expect(registered.map((item) => item.id)).toEqual(["f1", "f2"]);
    expect(registered[0]).toMatchObject({ title: "双重提问", severity: "major" });
  });

  it("全部条目无法解析才拒绝登记（空数组是合法零发现，不受影响）", async () => {
    const garbage = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "全坏",
        findings: [
          "不是对象",
          { id: "f1", title: "t", severity: "extreme", reason: "r", recommendation: "c" },
        ],
      },
      SURVEY_CTX,
    );
    expect(garbage.ok).toBeUndefined();
    expect(String(garbage.error)).toContain("全部无法解析");
    expect(garbage.invalid).toEqual([
      { index: 0, reason: "条目不是对象" },
      { index: 1, reason: expect.stringContaining("severity") },
    ]);
    expect(service.recordReview).not.toHaveBeenCalled();

    const zero = await tools.surveyReview.run(
      { baseDraftVersion: 3, summary: "零发现", findings: [] },
      SURVEY_CTX,
    );
    expect(zero.ok).toBe(true);
  });

  it("evidence 逐字守卫：题干/选项 label 的连续子串保留，内部 id 缩写剥离（P1-11）", async () => {
    const result = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "证据核对",
        findings: [
          { ...finding, evidence: "单选" }, // 题干「单选」的子串 → 保留
          { ...finding, id: "f2", evidence: "A" }, // 选项 label「A」 → 保留
          { ...finding, id: "f3", evidence: "options: a/b，无「其他」出口" }, // 内部 id 缩写 → 剥离
        ],
      },
      SURVEY_CTX,
    );
    expect(result.ok).toBe(true);
    const registered = result.findings as Array<{ id: string; evidence?: string }>;
    expect(registered.find((item) => item.id === "f1")!.evidence).toBe("单选");
    expect(registered.find((item) => item.id === "f2")!.evidence).toBe("A");
    expect(registered.find((item) => item.id === "f3")!.evidence).toBeUndefined();
    expect(result.droppedEvidence).toEqual(["f3"]);
    expect(String(result.note)).toContain("逐字摘录");
  });

  it("evidence 无题可锚（questionId 缺失）时不保留，宁缺毋假", async () => {
    const result = await tools.surveyReview.run(
      {
        baseDraftVersion: 3,
        summary: "整卷级发现",
        findings: [{ id: "f1", title: "覆盖缺口", severity: "minor", reason: "r", recommendation: "c", evidence: "单选" }],
      },
      SURVEY_CTX,
    );
    expect(result.ok).toBe(true);
    expect((result.findings as Array<{ evidence?: string }>)[0]).not.toHaveProperty("evidence");
    expect(result.droppedEvidence).toEqual(["f1"]);
  });

  it("缺 summary / 条数超限给出可自愈错误", async () => {
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
