import { randomUUID } from "node:crypto";

import type {
  CreateResearchRunInput,
  ResearchDatasetDetail,
  ResearchDatasetImportInput,
  ResearchDatasetSummary,
  SurveyResearchRecipe,
  ResearchRunDetail,
  ResearchRunSummary,
} from "../contracts/index.js";
import type { SurveyDefinition } from "../core/index.js";
import type { SurveysPorts } from "../ports.js";
import {
  RESEARCH_ENGINE_VERSION,
  analysisModelRecipes,
  runResearchAnalysis,
} from "../research/engine.js";
import { importResearchDataset } from "../research/dataset.js";
import type {
  ResearchDatasetRecord,
  ResearchRunRecord,
  ResearchStoragePort,
} from "../research/types.js";

import { SurveyError } from "./errors.js";
import { canonicalJson, sha256Hex } from "./serialize.js";
import { asDefinition, loadSurveyAccess } from "./service.js";

export interface ResearchServicePorts extends SurveysPorts {
  storage: SurveysPorts["storage"] & ResearchStoragePort;
}

function datasetSummary(row: ResearchDatasetRecord): ResearchDatasetSummary {
  return {
    id: row.id,
    surveyId: row.surveyId,
    revisionId: row.revisionId,
    name: row.name,
    source: row.source,
    sourceSha256: row.sourceSha256,
    parserVersion: row.parserVersion,
    rowCount: row.rowCount,
    duplicateRowCount: row.duplicateRowCount,
    mapping: row.mapping,
    inputHash: row.inputHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function datasetDetail(row: ResearchDatasetRecord): ResearchDatasetDetail {
  const missingByVariable = Object.fromEntries(
    row.mapping.map((mapping) => [
      mapping.variableId,
      row.normalizedRows.reduce(
        (count, record) => count + (record[mapping.variableId] === null ? 1 : 0),
        0,
      ),
    ]),
  );
  return {
    ...datasetSummary(row),
    rowsHash: row.rowsHash,
    columns: row.columns,
    normalizedRowHashes: row.normalizedRowHashes,
    missingByVariable,
  };
}

function runSummary(row: ResearchRunRecord): ResearchRunSummary {
  return {
    id: row.id,
    surveyId: row.surveyId,
    revisionId: row.revisionId,
    datasetId: row.datasetId,
    sourceKind: row.sourceKind,
    sourceSha256: row.sourceSha256,
    recipe: row.recipe,
    engineVersion: row.engineVersion,
    inputHash: row.inputHash,
    resultHash: row.resultHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function runDetail(row: ResearchRunRecord): ResearchRunDetail {
  return { ...runSummary(row), result: row.result };
}

function recipesOfModel(definition: SurveyDefinition, modelId: string): SurveyResearchRecipe[] {
  const model = definition.researchDesign?.analysisModels?.find(
    (candidate) => candidate.id === modelId,
  );
  if (!model)
    throw new SurveyError("invalid_recipe", 422, `研究设计不存在分析模型 ${modelId}`);
  return analysisModelRecipes(model);
}

export function createResearchService(ports: ResearchServicePorts) {
  async function access(userId: string, surveyId: string, write = false) {
    return loadSurveyAccess(ports, userId, surveyId, write ? "write" : "read");
  }

  async function requireDataset(
    userId: string,
    surveyId: string,
    datasetId: string,
    write = false,
  ): Promise<ResearchDatasetRecord> {
    await access(userId, surveyId, write);
    const row = await ports.storage.findResearchDataset(surveyId, datasetId);
    if (!row || row.surveyId !== surveyId)
      throw new SurveyError("not_found", 404);
    return row;
  }

  async function requireRun(
    userId: string,
    surveyId: string,
    runId: string,
  ): Promise<ResearchRunRecord> {
    await access(userId, surveyId);
    const row = await ports.storage.findResearchRun(surveyId, runId);
    if (!row || row.surveyId !== surveyId) throw new SurveyError("not_found", 404);
    return row;
  }

  return {
    async importDataset(userId: string, payload: ResearchDatasetImportInput) {
      const { survey } = await access(userId, payload.surveyId, true);
      const revision = await ports.storage.findRevisionOfSurvey(survey.id, payload.revisionId);
      if (!revision) throw new SurveyError("not_found", 404);
      const candidate = importResearchDataset({
        surveyId: survey.id,
        revisionId: revision.id,
        definition: asDefinition(revision.definitionJson),
        payload,
      });
      const existing = await ports.storage.findResearchDatasetByInput(
        survey.id,
        revision.id,
        candidate.inputHash,
      );
      if (existing) return datasetDetail(existing);
      const inserted = await ports.storage.insertResearchDataset(candidate);
      if (inserted.id !== candidate.id) return datasetDetail(inserted);
      return datasetDetail(candidate);
    },

    async listDatasets(userId: string, surveyId: string) {
      await access(userId, surveyId);
      return (await ports.storage.listResearchDatasets(surveyId)).map(datasetSummary);
    },

    async getDataset(userId: string, surveyId: string, datasetId: string) {
      return datasetDetail(await requireDataset(userId, surveyId, datasetId));
    },

    async createRun(userId: string, surveyId: string, input: CreateResearchRunInput) {
      await access(userId, surveyId, true);
      const dataset = await requireDataset(userId, surveyId, input.datasetId, true);
      const revision = await ports.storage.findRevisionOfSurvey(surveyId, dataset.revisionId);
      if (!revision) throw new SurveyError("not_found", 404);
      const definition = asDefinition(revision.definitionJson);
      // modelId 按定义内的结构化模型展开；附带 EFA 的模型会额外产出一个 EFA run，
      // 返回值是主分析（listRuns 可见全部）。
      const recipes = input.modelId !== undefined
        ? recipesOfModel(definition, input.modelId)
        : [input.recipe!];
      const createOne = async (recipe: SurveyResearchRecipe): Promise<ResearchRunRecord> => {
        const inputHash = sha256Hex(canonicalJson({
          datasetInputHash: dataset.inputHash,
          sourceSha256: dataset.sourceSha256,
          revisionContentHash: revision.contentHash,
          recipe,
          engineVersion: RESEARCH_ENGINE_VERSION,
        }));
        const existing = await ports.storage.findResearchRunByInput(surveyId, inputHash);
        if (existing) return existing;
        const result = runResearchAnalysis({ definition, dataset, recipe });
        const candidate: ResearchRunRecord = {
          id: randomUUID(),
          surveyId,
          revisionId: revision.id,
          datasetId: dataset.id,
          sourceKind: dataset.source.kind,
          sourceSha256: dataset.sourceSha256,
          recipe,
          engineVersion: RESEARCH_ENGINE_VERSION,
          inputHash,
          resultHash: sha256Hex(canonicalJson(result)),
          result,
          createdAt: new Date(),
        };
        const inserted = await ports.storage.insertResearchRun(candidate);
        return inserted.id === candidate.id ? candidate : inserted;
      };
      let primary: ResearchRunRecord | null = null;
      for (const recipe of recipes) {
        const run = await createOne(recipe);
        primary ??= run;
      }
      return runDetail(primary!);
    },

    async listRuns(userId: string, surveyId: string) {
      await access(userId, surveyId);
      return (await ports.storage.listResearchRuns(surveyId)).map(runSummary);
    },

    async getRun(userId: string, surveyId: string, runId: string) {
      return runDetail(await requireRun(userId, surveyId, runId));
    },

    async getRunExport(userId: string, surveyId: string, runId: string) {
      const run = await requireRun(userId, surveyId, runId);
      const dataset = await requireDataset(userId, surveyId, run.datasetId);
      if (
        run.revisionId !== dataset.revisionId ||
        run.sourceSha256 !== dataset.sourceSha256 ||
        run.sourceKind !== dataset.source.kind
      )
        throw new SurveyError("run_source_mismatch", 409, "固定运行与数据来源不一致");
      return { run, dataset };
    },
  };
}

export type ResearchService = ReturnType<typeof createResearchService>;
