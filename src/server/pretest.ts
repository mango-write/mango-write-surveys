import { z } from "zod";

import { SurveyAnswersSchema } from "../contracts/index.js";
import { PRETEST_ASPECTS, evaluateSurveyPath, validateSurveyAnswers, validateSurveyDefinition } from "../core/index.js";
import type { SurveysPorts } from "../ports.js";
import { SurveyError } from "./errors.js";
import { hashSessionToken, newSessionToken, sha256Hex, canonicalJson } from "./serialize.js";
import { asDefinition, loadSurveyAccess, toPublicDefinition } from "./service.js";

export const PRETEST_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PRETEST_ANSWER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PRETEST_MAX_SUBMISSIONS = 1000;

export const PretestSubmissionSchema = z.strictObject({
  submissionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  consent: z.literal(true),
  answers: SurveyAnswersSchema,
  feedback: z.array(z.strictObject({
    questionId: z.string().min(1).max(64),
    aspect: z.enum([...PRETEST_ASPECTS, "general"]),
    note: z.string().trim().min(1).max(1000),
  })).max(100),
});
export type PretestSubmission = z.infer<typeof PretestSubmissionSchema>;

export interface PretestRecord {
  id: string;
  surveyId: string;
  definition: unknown;
  draftVersion: number;
  contentFingerprint: string;
  expiresAt: Date;
}

export interface PretestSummary extends PretestRecord {
  submissions: Array<{
    id: string;
    completedAt: Date;
    feedback: unknown;
    answers: unknown;
    answerExpiresAt: Date;
  }>;
}

export interface PretestStoragePort {
  create(input: {
    surveyId: string;
    expectedVersion: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PretestRecord>;
  findByTokenHash(tokenHash: string): Promise<PretestRecord | null>;
  list(surveyId: string): Promise<PretestSummary[]>;
  submit(input: {
    pretestId: string;
    surveyId: string;
    tokenHash: string;
    submissionHash: string;
    inputHash: string;
    answers: PretestSubmission["answers"];
    feedback: PretestSubmission["feedback"];
    now: Date;
    answerExpiresAt: Date;
    maxSubmissions: number;
  }): Promise<{ id: string; completedAt: Date }>;
}

export function createPretestService(ports: SurveysPorts, storage: PretestStoragePort) {
  async function load(token: string, now: Date): Promise<PretestRecord> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SurveyError("not_found", 404);
    const pretest = await storage.findByTokenHash(hashSessionToken(token));
    if (!pretest || pretest.expiresAt.getTime() <= now.getTime()) throw new SurveyError("not_found", 404);
    const survey = await ports.storage.findById(pretest.surveyId, { excludeDeleted: true });
    if (!survey || !(await ports.auth.isCollectionAllowed(pretest.surveyId))) throw new SurveyError("not_found", 404);
    return pretest;
  }

  return {
    async create(userId: string, surveyId: string, expectedVersion: number, now = new Date()) {
      const { survey } = await loadSurveyAccess(ports, userId, surveyId, "write");
      if (survey.draftVersion !== expectedVersion) throw new SurveyError("version_conflict", 409);
      const definition = asDefinition(survey.draftJson);
      const issues = validateSurveyDefinition(definition);
      if (issues.length || !definition.pages.length || !definition.questions.some((q) => q.type !== "statement")) {
        throw new SurveyError("invalid_definition", 400, "试填前请先修复问卷结构", issues);
      }
      const token = newSessionToken();
      const pretest = await storage.create({
        surveyId,
        expectedVersion,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(now.getTime() + PRETEST_LINK_TTL_MS),
      });
      return { id: pretest.id, token, expiresAt: pretest.expiresAt.toISOString(), draftVersion: pretest.draftVersion };
    },

    async read(token: string, now = new Date()) {
      const pretest = await load(token, now);
      const definition = toPublicDefinition(asDefinition(pretest.definition));
      return {
        definition: {
          ...definition,
          questions: definition.questions.map((question) => {
            if (question.type !== "image_single" && question.type !== "image_multiple") return question;
            return { ...question, options: question.options.map(({ imageUrl: _imageUrl, ...option }) => option) };
          }),
        },
        expiresAt: pretest.expiresAt.toISOString(),
        answerRetentionDays: 30,
      };
    },

    async list(userId: string, surveyId: string, now = new Date()) {
      await loadSurveyAccess(ports, userId, surveyId, "read");
      const records = await storage.list(surveyId);
      return records.map((record) => {
        const definition = asDefinition(record.definition);
        const questions = definition.questions.filter((question) => question.type !== "statement");
        const counts = new Map(questions.map((question) => [question.id, { displayed: 0, unanswered: 0 }]));
        let availableAnswers = 0;
        for (const submission of record.submissions) {
          if (submission.answerExpiresAt.getTime() <= now.getTime() || submission.answers === null) continue;
          const parsed = SurveyAnswersSchema.safeParse(submission.answers);
          if (!parsed.success) throw new SurveyError("invalid_pretest", 500);
          availableAnswers += 1;
          for (const id of evaluateSurveyPath(definition, parsed.data).questionIds) {
            const count = counts.get(id);
            if (!count) continue;
            count.displayed += 1;
            if (parsed.data[id] === undefined) count.unanswered += 1;
          }
        }
        return {
          id: record.id,
          draftVersion: record.draftVersion,
          contentFingerprint: record.contentFingerprint,
          expiresAt: record.expiresAt.toISOString(),
          questions: questions.map((question) => ({ id: question.id, title: question.title })),
          answerSummary: {
            availableAnswers,
            questions: questions.map((question) => ({ questionId: question.id, ...counts.get(question.id)! })),
          },
          submissions: record.submissions.map((submission) => {
            const feedback = PretestSubmissionSchema.shape.feedback.safeParse(submission.feedback);
            if (!feedback.success) throw new SurveyError("invalid_pretest", 500);
            return { id: submission.id, completedAt: submission.completedAt.toISOString(), feedback: feedback.data };
          }),
        };
      });
    },

    async submit(token: string, input: unknown, now = new Date()) {
      const parsed = PretestSubmissionSchema.safeParse(input);
      if (!parsed.success) throw new SurveyError("invalid_input", 400);
      const pretest = await load(token, now);
      const definition = asDefinition(pretest.definition);
      const issues = validateSurveyAnswers(definition, parsed.data.answers);
      if (issues.length) throw new SurveyError("invalid_answers", 400, "答案不合法", issues);
      const questionIds = new Set(definition.questions.filter((q) => q.type !== "statement").map((q) => q.id));
      if (parsed.data.feedback.some((entry) => !questionIds.has(entry.questionId))) {
        throw new SurveyError("invalid_feedback", 400);
      }
      const result = await storage.submit({
        pretestId: pretest.id,
        surveyId: pretest.surveyId,
        tokenHash: hashSessionToken(token),
        submissionHash: hashSessionToken(parsed.data.submissionToken),
        inputHash: sha256Hex(canonicalJson({ answers: parsed.data.answers, feedback: parsed.data.feedback })),
        answers: parsed.data.answers,
        feedback: parsed.data.feedback,
        now,
        answerExpiresAt: new Date(now.getTime() + PRETEST_ANSWER_TTL_MS),
        maxSubmissions: PRETEST_MAX_SUBMISSIONS,
      });
      return { id: result.id, completedAt: result.completedAt.toISOString() };
    },

    async readAsset(token: string, fileId: string, now = new Date()) {
      const pretest = await load(token, now);
      const definition = asDefinition(pretest.definition);
      const referenced = definition.questions.some((question) =>
        (question.type === "image_single" || question.type === "image_multiple") &&
        question.options.some((option) => option.imageFileId === fileId),
      );
      if (!referenced) throw new SurveyError("not_found", 404);
      const binding = await ports.storage.findMediaBinding(fileId, pretest.surveyId);
      if (!binding) throw new SurveyError("not_found", 404);
      const bytes = await ports.media.get(binding.fileSha256);
      if (!bytes) throw new SurveyError("not_found", 404);
      return bytes;
    },
  };
}
