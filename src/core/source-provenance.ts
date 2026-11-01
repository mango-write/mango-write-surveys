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
    evidenceUrl: "https://iihm.imag.fr/coutrix/ens/MoSIG-HiL/1stAssignment/UsabilityQuestionnaire/JUS_Brooke_February_2013.pdf",
  },
  "gse-schwarzer-1995": {
    name: "General Self-Efficacy Scale (GSE)",
    author: "Ralf Schwarzer & Matthias Jerusalem",
    sourceUrl: "https://userpage.fu-berlin.de/~health/selfscal.htm",
    evidenceUrl: "https://userpage.fu-berlin.de/~health/self/gse-25countries_2002.pdf",
  },
  "phq9-kroenke-2001": {
    name: "Patient Health Questionnaire-9 (PHQ-9)",
    author: "Kroenke, Spitzer & Williams",
    sourceUrl: "https://phqscreeners.com/",
    evidenceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1495268/",
  },
  "gad7-spitzer-2006": {
    name: "Generalized Anxiety Disorder-7 (GAD-7)",
    author: "Spitzer, Kroenke, Williams & Löwe",
    sourceUrl: "https://phqscreeners.com/",
    evidenceUrl: "https://www.apaservices.org/practice/reimbursement/health-registry/anxiety-disorder-response.pdf",
  },
  "who5-who-1998": {
    name: "WHO-5 Well-Being Index",
    author: "World Health Organization",
    sourceUrl: "https://www.who.int/",
    evidenceUrl: "https://cdn.who.int/media/docs/default-source/mental-health/who-5_english-original4da539d6ed4b49389e3afe47cda2326a.pdf",
  },
} as const;

export function surveySourceState(definition: SurveyDefinition, questionId: string, baseline: string): "unchanged" | "modified" | "missing" {
  const question = definition.questions.find((item) => item.id === questionId);
  if (!question || !definition.pages.some((page) => page.questionIds.includes(questionId))) return "missing";
  return canonicalSurveyJson(question) === baseline ? "unchanged" : "modified";
}
