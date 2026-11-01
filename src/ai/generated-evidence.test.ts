import { describe, expect, it } from "vitest";
import { normalizeGeneratedFields, normalizeResearchMappings, redundantConsentQuestion, stripUnverifiedParticipationText, stripUnverifiedPopulation, unknownResearchMappings, unmeasuredAnalysisGroup, unsupportedGroupComparison, unverifiedGeneratedInstitution, unverifiedGeneratedPeriod, unverifiedPopulationScope, unverifiedReliabilityClaim } from "./generated-evidence.js";
import type { SurveyDefinition } from "../core/index.js";

function survey(): SurveyDefinition {
  return { version: 1, title: "调查", description: "本调查了解工具使用。问卷匿名，预计占用 8–10 分钟。", consent: "参与自愿。",
    questions: [{ id: "q1", type: "text", title: "过去半年使用情况", required: false }], pages: [{ id: "p1", title: "问题", questionIds: ["q1"] }],
    researchDesign: { researchQuestion: "工具使用", population: "华中师范大学课题组学生", recruitment: "", analysisPlan: "描述", constructs: [], assumptions: [], pendingDecisions: [] } };
}
describe("AI 建卷事实依据", () => {
  it("补齐无歧义的内部标识和选答默认值，不覆盖显式内容", () => {
    const raw = { questions: [{ type: "single", title: "问题", options: [{ id: "o1", label: "是" }, { label: "否" }] }], pages: [{ title: "问题", questionIds: ["q1"] }] };
    const normalized = normalizeGeneratedFields(raw) as { version: number; questions: Array<{ id: string; required: boolean; options: Array<{ id: string }> }>; pages: Array<{ id: string }> };
    expect(normalized.version).toBe(1);
    expect(normalized.questions[0]).toMatchObject({ id: "q1", required: false, options: [{ id: "o1" }, { id: "o2" }] });
    expect(normalized.pages[0]?.id).toBe("p1");
    expect(raw.questions[0]).not.toHaveProperty("required");
  });
  it("用户没有给出具体期限或机构时不能将其当成已知事实", () => {
    expect(unverifiedGeneratedPeriod(survey(), ["研究现在的使用情况"])).toBe("过去半年");
    expect(unverifiedGeneratedPeriod(survey(), ["研究过去半年使用情况"])).toBeNull();
    expect(unverifiedGeneratedPeriod(survey(), ["研究近六个月的使用情况"])).toBeNull();
    expect(unverifiedGeneratedPeriod(survey(), ["不要限定过去半年"])).toBe("过去半年");
    const future = survey();
    future.questions[0]!.title = "未来一年你会共享数据吗？";
    expect(unverifiedGeneratedPeriod(future, ["了解学生的态度"])).toBe("未来一年");
    expect(unverifiedGeneratedPeriod(future, ["了解未来一年共享数据的意愿"])).toBeNull();
    expect(unverifiedGeneratedPeriod(future, ["了解接下来12个月共享数据的意愿"])).toBeNull();
    expect(unverifiedGeneratedPeriod(future, ["了解过去一年共享数据的意愿"])).toBe("未来一年");
    future.questions[0]!.title = "你是否共享数据？";
    future.researchDesign!.assumptions = ["按未来一年内的计划回答"];
    expect(unverifiedGeneratedPeriod(future, ["了解学生的态度"])).toBe("未来一年");
    expect(unverifiedGeneratedInstitution(survey(), ["我们组学生"])).toContain("华中师范大学");
    expect(unverifiedGeneratedInstitution(survey(), ["华中师范大学课题组"])).toBeNull();
    expect(unverifiedGeneratedInstitution(survey(), ["我们不是华中师范大学的学生"])).toContain("华中师范大学");
    const generic = survey();
    generic.researchDesign!.population = "来自不同学院的学生";
    expect(unverifiedGeneratedInstitution(generic, ["研究学生的情况"])).toBeNull();
  });
  it("从填写者可见说明移除未确认的匿名与填写时间承诺", () => {
    const definition = survey();
    definition.researchDesign!.assumptions = ["匿名自填", "采用便利样本"];
    expect(stripUnverifiedParticipationText(definition, ["不收集姓名"])).toEqual({ privacy: true, duration: true });
    expect(definition.description).toBe("本调查了解工具使用。");
    expect(definition.consent).toBe("参与自愿。");
    expect(definition.researchDesign!.assumptions).toEqual(["采用便利样本"]);
    expect(definition.researchDesign!.pendingDecisions).toContain("数据处理方式待确认");
  });
  it("只保留有依据的数据用途和不同语言的填写时间", () => {
    const definition = survey();
    definition.description = "数据仅用于汇总分析。填写大约十分钟。";
    definition.consent = "The survey takes five minutes. It takes a few minutes to complete.";
    expect(stripUnverifiedParticipationText(definition, [])).toEqual({ privacy: true, duration: true });
    expect(definition.description).toBe("");
    expect(definition.consent).toBe("");
    definition.description = "数据仅用于汇总分析。填写大约十分钟。";
    definition.consent = "The survey takes five minutes.";
    expect(stripUnverifiedParticipationText(definition, ["数据仅用于汇总分析", "填写时间十分钟", "finish in five minutes"])).toEqual({ privacy: false, duration: false });
    expect(definition.description).toContain("汇总分析");
    expect(definition.consent).toContain("five minutes");
  });
  it("不会把泛指的学生推断成研究生", () => {
    const definition = survey();
    definition.researchDesign!.population = "课题组研究生";
    expect(stripUnverifiedPopulation(definition, ["我们组学生"])).toBe(true);
    expect(definition.researchDesign).toMatchObject({ population: "", pendingDecisions: ["目标人群待确认"] });
    definition.researchDesign!.population = "课题组研究生";
    expect(stripUnverifiedPopulation(definition, ["我们组的研究生"])).toBe(false);
    expect(definition.researchDesign!.population).toBe("课题组研究生");
    definition.researchDesign!.population = "课题组研究生";
    expect(stripUnverifiedPopulation(definition, ["不是研究生"])).toBe(true);
    definition.description = "面向组内研究生的开放科学问卷";
    expect(unverifiedPopulationScope(definition, ["我们组学生"])).toBe(true);
    expect(unverifiedPopulationScope(definition, ["我们组研究生"])).toBe(false);
    definition.description = "面向组内学生的开放科学问卷";
    definition.questions[0]!.title = "你参与科研（读研/读博至今）多长时间？";
    expect(unverifiedPopulationScope(definition, ["我们组学生"])).toBe(true);
  });
  it("识别与内置参与同意重复的题目，普通态度题不受影响", () => {
    const definition = survey();
    definition.questions.push({ id: "agree", type: "single", title: "您是否同意参与本次研究？", required: true,
      options: [{ id: "yes", label: "同意" }, { id: "no", label: "不同意（问卷结束）" }] });
    expect(redundantConsentQuestion(definition)).toBe("agree");
    definition.questions[1]!.title = "您同意数据共享吗？";
    expect(redundantConsentQuestion(definition)).toBeNull();
  });
  it("不能按问卷没有收集的年级分组", () => {
    const definition = survey();
    definition.researchDesign!.analysisPlan = "按年级分组比较";
    expect(unmeasuredAnalysisGroup(definition)).toBe("年级");
    definition.questions[0]!.title = "你目前的年级是？";
    expect(unmeasuredAnalysisGroup(definition)).toBeNull();
    definition.questions[0]!.title = "使用情况";
    definition.researchDesign!.analysisPlan = "补充年级后再按年级分组比较";
    expect(unmeasuredAnalysisGroup(definition)).toBeNull();
  });
  it("说明块标题中的匿名与数据用途承诺同样会被移除", () => {
    const definition = survey();
    definition.questions.push({ id: "s_consent", type: "statement", title: "说明：本问卷匿名填写，数据仅用于内部学术研究。", body: "", required: false });
    expect(stripUnverifiedParticipationText(definition, [])).toEqual({ privacy: true, duration: true });
    expect(definition.questions[1]).toMatchObject({ title: "" });
  });
  it("招募说明里的匿名作答承诺也会被移除", () => {
    const definition = survey();
    definition.researchDesign!.recruitment = "通过学院群自愿招募，匿名作答";
    expect(stripUnverifiedParticipationText(definition, ["通过学院群自愿招募"])).toEqual({ privacy: true, duration: true });
    expect(definition.researchDesign!.recruitment).toContain("通过学院群自愿招募");
    expect(definition.researchDesign!.recruitment).not.toContain("匿名");
  });
  it("单题构念不能声称 Cronbach α 等内部一致性指标", () => {
    const definition = survey();
    definition.researchDesign!.constructs = [{ id: "c1", label: "行为意愿", definition: "意愿", questionIds: ["q1"] }];
    definition.researchDesign!.analysisPlan = "对构念与行为意愿做描述统计和 Cronbach α 信度";
    expect(unverifiedReliabilityClaim(definition)).toBe("行为意愿");
    definition.researchDesign!.analysisPlan = "对多题构念计算 Cronbach α，单题构念只做描述";
    expect(unverifiedReliabilityClaim(definition)).toBeNull();
    definition.questions.push({ id: "q2", type: "text", title: "另一个意愿题", required: false });
    definition.pages[0]!.questionIds.push("q2");
    definition.researchDesign!.constructs = [{ id: "c1", label: "行为意愿", definition: "意愿", questionIds: ["q1", "q2"] }];
    definition.researchDesign!.analysisPlan = "对构念与行为意愿做描述统计和 Cronbach α 信度";
    expect(unverifiedReliabilityClaim(definition)).toBeNull();
    definition.researchDesign!.constructs = [{ id: "c1", label: "行为意愿", definition: "意愿", questionIds: ["q1"] }];
    definition.researchDesign!.analysisPlan = "描述统计";
    expect(unverifiedReliabilityClaim(definition)).toBeNull();
  });
  it("两组以上的年级分组不能默认均值比较", () => {
    const definition = survey();
    definition.questions[0] = { id: "q1", type: "single", title: "你目前的年级是？", required: true,
      options: [{ id: "g1", label: "研一" }, { id: "g2", label: "研二" }, { id: "g3", label: "研三" }] };
    definition.researchDesign!.analysisPlan = "按年级分组比较均值";
    expect(unsupportedGroupComparison(definition)).toBe("年级");
    definition.researchDesign!.analysisPlan = "按年级分组比较均值；两组以上检验需外部工具";
    expect(unsupportedGroupComparison(definition)).toBeNull();
    definition.researchDesign!.analysisPlan = "按年级分组，用交叉表呈现构成";
    expect(unsupportedGroupComparison(definition)).toBeNull();
    definition.questions[0] = { ...definition.questions[0]!, options: [{ id: "g1", label: "研一" }, { id: "g2", label: "研二" }] };
    definition.researchDesign!.analysisPlan = "按年级分组比较均值";
    expect(unsupportedGroupComparison(definition)).toBeNull();
  });
  it("说明块不应作为研究问题的可答题映射", () => {
    const definition = survey();
    definition.questions.push({ id: "intro", type: "statement", title: "说明", body: "背景", required: false });
    definition.pages[0]!.questionIds.push("intro");
    definition.researchDesign!.constructs = [{ id: "c1", label: "用途", definition: "用途", questionIds: ["q1", "intro"] }];
    expect(normalizeResearchMappings(definition)).toEqual([]);
    expect(definition.researchDesign!.constructs[0]!.questionIds).toEqual(["q1"]);
    definition.researchDesign!.constructs[0]!.questionIds.push("missing");
    expect(unknownResearchMappings(definition)).toEqual(["missing"]);
  });
});
