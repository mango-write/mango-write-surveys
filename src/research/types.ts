import type {
  ResearchColumnMapping,
  SurveyResearchRecipe,
  SurveyResearchResult,
  ResearchSource,
} from "../contracts/index.js";
import type { SurveyDefinition } from "../core/index.js";

export interface ResearchDatasetRecord {
  id: string;
  surveyId: string;
  revisionId: string;
  name: string;
  source: ResearchSource;
  sourceSha256: string;
  parserVersion: string;
  rowCount: number;
  /** 完全重复（映射列规范化后逐列相等）的记录条数，只披露不删除。 */
  duplicateRowCount: number;
  mapping: ResearchColumnMapping[];
  columns: string[];
  normalizedRows: Array<Record<string, number | null>>;
  normalizedRowHashes: string[];
  rowsHash: string;
  inputHash: string;
  createdAt: Date;
}

export interface ResearchRunRecord {
  id: string;
  surveyId: string;
  revisionId: string;
  datasetId: string;
  sourceKind: "public" | "synthetic";
  sourceSha256: string;
  recipe: SurveyResearchRecipe;
  engineVersion: string;
  inputHash: string;
  resultHash: string;
  result: SurveyResearchResult;
  createdAt: Date;
}

export interface ResearchStoragePort {
  findResearchDatasetByInput(
    surveyId: string,
    revisionId: string,
    inputHash: string,
  ): Promise<ResearchDatasetRecord | null>;
  findResearchDataset(
    surveyId: string,
    datasetId: string,
  ): Promise<ResearchDatasetRecord | null>;
  listResearchDatasets(surveyId: string): Promise<ResearchDatasetRecord[]>;
  insertResearchDataset(record: ResearchDatasetRecord): Promise<ResearchDatasetRecord>;
  findResearchRunByInput(
    surveyId: string,
    inputHash: string,
  ): Promise<ResearchRunRecord | null>;
  findResearchRun(surveyId: string, runId: string): Promise<ResearchRunRecord | null>;
  listResearchRuns(surveyId: string): Promise<ResearchRunRecord[]>;
  insertResearchRun(record: ResearchRunRecord): Promise<ResearchRunRecord>;
}

export interface ResearchAnalysisInput {
  definition: SurveyDefinition;
  dataset: ResearchDatasetRecord;
  recipe: SurveyResearchRecipe;
}
