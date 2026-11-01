import { describe, expect, it } from "vitest";
import { makeDefinition } from "./test-fixtures.js";
import { applySurveyOps } from "./ops.js";
import { canRecordAiAddedQuestions, recordAiAddedQuestions, surveySourceState } from "./source-provenance.js";
import { unresolvedReviewChoice } from "./review-safety.js";
import { buildSurveyReviewPlan } from "./review-plan.js";

describe("AI 新增题目来源", () => {
  it("只标记新问题，并可在修改后识别变化", () => {
    const before = makeDefinition();
    const added = applySurveyOps(before, [{ op: "add_question", pageId: "p1", question: { id: "ai-q", type: "text", title: "补充问题", required: false } }]).definition;
    const result = recordAiAddedQuestions(before, added);
    expect(result.sourceRecords).toHaveLength(1);
    expect(result.sourceRecords?.[0]).toMatchObject({ questionId: "ai-q", sourceId: "ai-generated-unverified" });
    const edited = applySurveyOps(result, [{ op: "update_question", questionId: "ai-q", patch: { title: "改写" } }]).definition;
    expect(surveySourceState(edited, "ai-q", result.sourceRecords![0]!.baselineQuestion)).toBe("modified");
    expect(recordAiAddedQuestions(result, edited)).toBe(edited);
  });
  it("来源记录已满时不静默截断新增题来源，单条与整批修订都不能应用", () => {
    const before = makeDefinition();
    before.sourceRecords = Array.from({ length: 50 }, (_, index) => ({ sourceId: "old", questionId: `old${index}`, language: "und", baselineQuestion: "{}" }));
    const op = { op: "add_question" as const, pageId: "p1", question: { id: "new", type: "text" as const, title: "新增", required: false } };
    const added = applySurveyOps(before, [op]).definition;
    expect(canRecordAiAddedQuestions(before, added)).toBe(false);
    expect(() => recordAiAddedQuestions(before, added)).toThrow("survey_source_capacity");
    expect(unresolvedReviewChoice([op], before)).toBe("source_capacity");
    const plan = buildSurveyReviewPlan(before, [{ id: "f", title: "补题", severity: "major", reason: "缺题", recommendation: "补题", suggestedOps: [op] }]);
    expect(plan.status).toBe("blocked");
    expect(plan.candidateDefinition).toBeNull();
    expect(before.sourceRecords).toHaveLength(50);
  });
  it("不能将新题误认成已删除题的来源", () => {
    const before = makeDefinition();
    before.sourceRecords = [{ sourceId: "sus-brooke-1996", questionId: "old", language: "zh", baselineQuestion: "{}" }];
    const reused = applySurveyOps(before, [{ op: "add_question", pageId: "p1", question: { id: "old", type: "text", title: "新问题", required: false } }]).definition;
    expect(canRecordAiAddedQuestions(before, reused)).toBe(false);
  });
});
