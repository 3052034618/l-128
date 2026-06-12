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
  IndustryRequiredFieldsConfig,
  AuditSummaryReport,
  ScoringComparisonResult,
  ComparisonOptions,
  AuditDeliveryPackage,
  MultiScoringComparisonResult,
  MultiComparisonOptions,
  RuleImpactAnalysisResult,
  RuleImpactAnalysisOptions,
} from './types';

import { ScoringEngine } from './core/ScoringEngine';
import { BatchScoringService } from './core/BatchScoringService';
import { ReportGenerator, TextReportOptions, JsonReportOptions } from './core/ReportGenerator';
import { DetailLogger } from './core/logger';
import { IndustryRuleRegistry } from './core/IndustryRuleRegistry';
import { ScoringResultComparer } from './core/ScoringResultComparer';
import { MultiScoringComparer } from './core/MultiScoringComparer';
import { RuleImpactAnalyzer } from './core/RuleImpactAnalyzer';
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
  validateAndNormalizeWeights,
  getIndustryConfig,
  safePercentage,
  clampScore,
  LOW_SCORE_THRESHOLD,
  DEFAULT_AUDIT_PASS_THRESHOLD,
  DIMENSION_NAMES,
  getZeroWeightDimensions,
} from './config';

export {
  ScoringEngine,
  BatchScoringService,
  ReportGenerator,
  DetailLogger,
  IndustryRuleRegistry,
  ScoringResultComparer,
  MultiScoringComparer,
  RuleImpactAnalyzer,
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
  validateAndNormalizeWeights,
  getIndustryConfig,
  safePercentage,
  clampScore,
  LOW_SCORE_THRESHOLD,
  DEFAULT_AUDIT_PASS_THRESHOLD,
  DIMENSION_NAMES,
  getZeroWeightDimensions,
};

export type { TextReportOptions, JsonReportOptions };

export class DataQualitySDK {
  private engine: ScoringEngine;
  private batchService: BatchScoringService;
  private reportGenerator: ReportGenerator;
  private ruleRegistry: IndustryRuleRegistry;
  private options: SDKOptions;

  constructor(options: SDKOptions = {}) {
    this.options = options;
    this.engine = new ScoringEngine({
      defaultWeights: options.defaultWeights,
      defaultIndustry: options.defaultIndustry,
      enableDetailLogByDefault: options.enableDetailLogByDefault,
      customSensitiveFieldPatterns: options.customSensitiveFieldPatterns,
      customIndustryConfigs: options.customIndustryConfigs,
      autoNormalizeWeights: options.autoNormalizeWeights,
      handleZeroWeightAs: options.handleZeroWeightAs,
      auditPassThreshold: options.auditPassThreshold,
      usePublishedRulesOnly: options.usePublishedRulesOnly,
      allowTrialRules: options.allowTrialRules,
    });
    this.batchService = new BatchScoringService(options);
    this.reportGenerator = new ReportGenerator();
    this.ruleRegistry = IndustryRuleRegistry.getInstance();
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
      industryConfigVersion?: string;
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
      industryConfigVersion: params.industryConfigVersion,
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

  generateMarkdownReport(result: ScoringResult, options?: TextReportOptions): string {
    return this.reportGenerator.generateMarkdownReport(result, options);
  }

  generateJsonReport(result: ScoringResult, options?: JsonReportOptions): string {
    return this.reportGenerator.generateJsonReport(result, options);
  }

  generateAuditSummaryReport(result: ScoringResult): AuditSummaryReport {
    return this.reportGenerator.generateAuditSummaryReport(result, {
      passThreshold: this.options.auditPassThreshold,
    });
  }

  generateAuditSummaryText(
    result: ScoringResult,
    format: 'text' | 'markdown' = 'text'
  ): string {
    return this.reportGenerator.generateAuditSummaryText(result, {
      format,
      passThreshold: this.options.auditPassThreshold,
    });
  }

  generateBatchSummaryReport(
    result: BatchScoringResult,
    format: 'text' | 'markdown' = 'text'
  ): string {
    return this.reportGenerator.generateBatchSummaryReport(result, { format, includeGroups: true });
  }

  generateComparisonReport(
    resultA: ScoringResult,
    resultB: ScoringResult,
    options?: ComparisonOptions & { format?: 'text' | 'markdown' }
  ): string {
    const comparison = ScoringResultComparer.compare(resultA, resultB, options);
    return this.reportGenerator.generateComparisonReport(comparison, {
      format: options?.format || 'text',
    });
  }

  compareScoringResults(
    resultA: ScoringResult,
    resultB: ScoringResult,
    options?: ComparisonOptions
  ): ScoringComparisonResult {
    return ScoringResultComparer.compare(resultA, resultB, options);
  }

  getRuleRegistry(): IndustryRuleRegistry {
    return this.ruleRegistry;
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

  compareMultiScoringResults(
    results: ScoringResult[],
    options?: MultiComparisonOptions
  ): MultiScoringComparisonResult {
    return MultiScoringComparer.compare(results, options);
  }

  generateMultiComparisonReport(
    results: ScoringResult[],
    options?: MultiComparisonOptions & { format?: 'text' | 'markdown' }
  ): string {
    const comparison = MultiScoringComparer.compare(results, options);
    return this.reportGenerator.generateMultiComparisonReport(comparison, {
      format: options?.format || 'text',
    });
  }

  analyzeRuleImpact(
    inputs: Array<{
      productId: string;
      description?: DataProductDescription;
      fields: FieldDefinition[];
      sample: SampleSummary;
      authorization: AuthorizationScope;
      industry?: IndustryType;
      customWeights?: Partial<ScoringWeights>;
      industryConfigVersion?: string;
    }>,
    targetVersion: string,
    options?: {
      industry?: IndustryType;
      baselineVersion?: string;
    }
  ): RuleImpactAnalysisResult {
    const analyzer = new RuleImpactAnalyzer(this.engine);
    return analyzer.analyzeBatchImpact(inputs as any[], targetVersion, options);
  }

  generateImpactAnalysisReport(
    analysis: RuleImpactAnalysisResult,
    format: 'text' | 'markdown' = 'text'
  ): string {
    return this.reportGenerator.generateImpactAnalysisReport(analysis, { format });
  }

  generateAuditDeliveryPackage(
    batchResult: BatchScoringResult,
    options?: {
      applicationId?: string;
      passThreshold?: number;
      baselineResults?: ScoringResult[];
      baselineLabel?: string;
      targetLabel?: string;
    }
  ): AuditDeliveryPackage {
    return this.reportGenerator.generateAuditDeliveryPackage(batchResult, {
      ...options,
      passThreshold: options?.passThreshold ?? this.options.auditPassThreshold,
    });
  }

  generateAuditDeliveryPackageText(
    batchResult: BatchScoringResult,
    options?: {
      applicationId?: string;
      format?: 'text' | 'markdown';
      passThreshold?: number;
      baselineResults?: ScoringResult[];
      baselineLabel?: string;
      targetLabel?: string;
    }
  ): string {
    return this.reportGenerator.generateAuditDeliveryPackageText(batchResult, {
      ...options,
      passThreshold: options?.passThreshold ?? this.options.auditPassThreshold,
    });
  }

  overrideIndustryRule(
    industry: IndustryType,
    version: string,
    config: IndustryRequiredFieldsConfig
  ): void {
    this.ruleRegistry.overrideRule(industry, version, config);
  }
}

export default DataQualitySDK;
