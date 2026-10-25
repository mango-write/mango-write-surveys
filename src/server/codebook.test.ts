import { describe, expect, it, vi } from "vitest";
import type { SurveysPorts, SurveyRecord } from "../ports.js";
import { SurveyCodebookSchema } from "../contracts/index.js";
import { makeDefinition } from "../core/test-fixtures.js";
import { createSurveysService } from "./service.js";

const surveyId = "00000000-0000-4000-8000-000000000001";
const revisionId = "00000000-0000-4000-8000-000000000002";

function setup() {
  const definition = makeDefinition();
  const findRevisionOfSurvey = vi.fn(async (requestedSurveyId: string, requestedRevisionId: string) =>
    requestedSurveyId === surveyId && requestedRevisionId === revisionId ? ({
    id: revisionId,
    surveyId,
    revision: 1,
    definitionJson: definition,
    contentHash: "a".repeat(64),
    createdAt: new Date(),
  }) : null);
  const resolveResourceAccess = vi.fn(async () => ({ canRead: true, canWrite: false, canDelete: false }));
  const ports = {
    auth: { resolveResourceAccess },
    storage: {
      findById: vi.fn(async () => ({ id: surveyId, currentRevisionId: "00000000-0000-4000-8000-000000000003", draftJson: { ...definition, questions: [], pages: [] } }) as SurveyRecord),
      findRevisionOfSurvey,
    },
  } as unknown as SurveysPorts;
  return { service: createSurveysService(ports), definition, findRevisionOfSurvey, resolveResourceAccess };
}

describe("published codebook definition", () => {
  it("returns the selected revision definition even after the draft changes", async () => {
    const { service, definition, findRevisionOfSurvey } = setup();
    const codebook = await service.surveyCodebook("reader", surveyId, revisionId);
    expect(SurveyCodebookSchema.parse(codebook).definition).toEqual(definition);
    expect(codebook.definition.questions).toHaveLength(definition.questions.length);
    expect(findRevisionOfSurvey).toHaveBeenCalledWith(surveyId, revisionId);
  });

  it("checks read access before reading a revision", async () => {
    const { service, resolveResourceAccess, findRevisionOfSurvey } = setup();
    resolveResourceAccess.mockResolvedValue({ canRead: false, canWrite: false, canDelete: false });
    await expect(service.surveyCodebook("other", surveyId, revisionId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(findRevisionOfSurvey).not.toHaveBeenCalled();
  });

  it("rejects a revision that is not part of the requested survey", async () => {
    const { service, findRevisionOfSurvey } = setup();
    const foreignRevisionId = "00000000-0000-4000-8000-000000000004";
    await expect(service.surveyCodebook("reader", surveyId, foreignRevisionId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(findRevisionOfSurvey).toHaveBeenCalledWith(surveyId, foreignRevisionId);
  });

  it("does not fall back to the draft for an unavailable revision", async () => {
    const { service, findRevisionOfSurvey } = setup();
    findRevisionOfSurvey.mockResolvedValue(null);
    await expect(service.surveyCodebook("reader", surveyId, revisionId)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
