import type { SurveyDefinition } from "./definition.js";
import { SURVEY_LIMITS } from "./definition.js";
import { canonicalSurveyJson } from "./hash.js";

export const AI_GENERATED_SOURCE_ID = "ai-generated-unverified";

function unrecordedAddedQuestions(before: SurveyDefinition, after: SurveyDefinition) {
  const existing = new Set(before.questions.map((question) => question.id));
  return after.questions.filter((question) => question.type !== "statement" && !existing.has(question.id));
}

export function canRecordAiAddedQuestions(before: SurveyDefinition, after: SurveyDefinition): boolean {
  const records = after.sourceRecords ?? [];
  const added = unrecordedAddedQuestions(before, after);
  const recorded = new Set(records.map((record) => record.questionId));
  return records.length + added.length <= SURVEY_LIMITS.maxQuestions && added.every((question) => !recorded.has(question.id));
}

export function recordAiAddedQuestions(before: SurveyDefinition, after: SurveyDefinition): SurveyDefinition {
  if (!canRecordAiAddedQuestions(before, after)) throw new Error("survey_source_capacity");
  const records = after.sourceRecords ?? [];
  const added = unrecordedAddedQuestions(before, after)
    .map((question) => ({ sourceId: AI_GENERATED_SOURCE_ID, questionId: question.id, language: "und", baselineQuestion: canonicalSurveyJson(question) }));
  return added.length ? { ...after, sourceRecords: [...records, ...added] } : after;
}

export const SURVEY_SOURCE_CATALOG = {
  "sus-brooke-1996": {
    name: "System Usability Scale (SUS)",
    author: "John Brooke",
    sourceUrl: "https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf",
    evidenceUrl: "https://iihm.imag.fr/coutrix/ens/M2-MoSIG-HiL/1stAssignment/UsabilityQuestionnaire/JUS_Brooke_February_2013.pdf",
  },
} as const;

export function surveySourceState(definition: SurveyDefinition, questionId: string, baseline: string): "unchanged" | "modified" | "missing" {
  const question = definition.questions.find((item) => item.id === questionId);
  if (!question || !definition.pages.some((page) => page.questionIds.includes(questionId))) return "missing";
  return canonicalSurveyJson(question) === baseline ? "unchanged" : "modified";
}
