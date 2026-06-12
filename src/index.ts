export * from './types';

import {
  ScoringInput,
  ScoringResult,
  BatchScoringInput,
  BatchScoringResult,
  SDKOptions,
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  ScoringWeights,
  IndustryType,
} from './types';

import { ScoringEngine } from './core/ScoringEngine';
import { BatchScoringService } from './core/BatchScoringService';
import { ReportGenerator, TextReportOptions, JsonReportOptions } from './core/ReportGenerator';
import { DetailLogger } from './core/logger';
import {
  FieldCompletenessValidator,
  SampleCompletenessValidator,
  SensitiveFieldRecognizer,
  UpdateFrequencyScorer,
  DescriptionCompletenessValidator,
  AuthorizationValidator,
} from './validators';
import {
  DEFAULT_SCORING_WEIGHTS,
  INDUSTRY_REQUIRED_FIELDS,
  UPDATE_FREQUENCY_SCORES,
  GRADE_THRESHOLDS,
  DEFAULT_SENSITIVE_FIELD_PATTERNS,
  DESCRIPTION_REQUIRED_FIELDS,
} from './config';

export {
  ScoringEngine,
  BatchScoringService,
  ReportGenerator,
  DetailLogger,
  FieldCompletenessValidator,
  SampleCompletenessValidator,
  SensitiveFieldRecognizer,
  UpdateFrequencyScorer,
  DescriptionCompletenessValidator,
  AuthorizationValidator,
  DEFAULT_SCORING_WEIGHTS,
  INDUSTRY_REQUIRED_FIELDS,
  UPDATE_FREQUENCY_SCORES,
  GRADE_THRESHOLDS,
  DEFAULT_SENSITIVE_FIELD_PATTERNS,
  DESCRIPTION_REQUIRED_FIELDS,
};

export type { TextReportOptions, JsonReportOptions };

export class DataQualitySDK {
  private engine: ScoringEngine;
  private batchService: BatchScoringService;
  private reportGenerator: ReportGenerator;
  private options: SDKOptions;

  constructor(options: SDKOptions = {}) {
    this.options = options;
    this.engine = new ScoringEngine({
      defaultWeights: options.defaultWeights,
      defaultIndustry: options.defaultIndustry,
      enableDetailLogByDefault: options.enableDetailLogByDefault,
      customSensitiveFieldPatterns: options.customSensitiveFieldPatterns,
      customIndustryConfigs: options.customIndustryConfigs,
    });
    this.batchService = new BatchScoringService(options);
    this.reportGenerator = new ReportGenerator();
  }

  score(
    params: {
      productId: string;
      description?: DataProductDescription;
      fields: FieldDefinition[];
      sample: SampleSummary;
      authorization: AuthorizationScope;
      industry?: IndustryType;
      customWeights?: Partial<ScoringWeights>;
      enableDetailLog?: boolean;
    }
  ): ScoringResult {
    const input: ScoringInput = {
      productId: params.productId,
      description: params.description,
      fields: params.fields,
      sample: params.sample,
      authorization: params.authorization,
      industry: params.industry,
      customWeights: params.customWeights,
      enableDetailLog: params.enableDetailLog,
    };
    return this.engine.score(input);
  }

  scoreBatch(input: BatchScoringInput): BatchScoringResult {
    return this.batchService.scoreBatch(input);
  }

  async scoreBatchAsync(
    input: BatchScoringInput,
    options?: { concurrency?: number; onProgress?: (current: number, total: number) => void }
  ): Promise<BatchScoringResult> {
    return this.batchService.scoreBatchAsync(input, options);
  }

  generateTextReport(result: ScoringResult, options?: TextReportOptions): string {
    return this.reportGenerator.generateTextReport(result, options);
  }

  generateJsonReport(result: ScoringResult, options?: JsonReportOptions): string {
    return this.reportGenerator.generateJsonReport(result, options);
  }

  generateBatchSummaryReport(result: BatchScoringResult): string {
    return this.reportGenerator.generateBatchSummaryReport(result);
  }

  getEngine(): ScoringEngine {
    return this.engine;
  }

  getReportGenerator(): ReportGenerator {
    return this.reportGenerator;
  }

  getDefaultWeights(): ScoringWeights {
    return { ...DEFAULT_SCORING_WEIGHTS, ...(this.options.defaultWeights || {}) };
  }
}

export default DataQualitySDK;
