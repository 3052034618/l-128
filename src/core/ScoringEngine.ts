import {
  ScoringInput,
  ScoringResult,
  ScoringWeights,
  QualityGrade,
  RiskItem,
  RiskLevel,
  IndustryRequiredFieldsConfig,
} from '../types';
import {
  DEFAULT_SCORING_WEIGHTS,
  GRADE_THRESHOLDS,
  validateAndNormalizeWeights,
  clampScore,
  safePercentage,
  SensitiveFieldPattern,
  getIndustryConfig,
} from '../config';
import { DetailLogger } from './logger';
import { FieldCompletenessValidator } from '../validators/FieldCompletenessValidator';
import { SampleCompletenessValidator } from '../validators/SampleCompletenessValidator';
import { SensitiveFieldRecognizer } from '../validators/SensitiveFieldRecognizer';
import { UpdateFrequencyScorer } from '../validators/UpdateFrequencyScorer';
import { DescriptionCompletenessValidator } from '../validators/DescriptionCompletenessValidator';
import { AuthorizationValidator } from '../validators/AuthorizationValidator';

export class ScoringEngine {
  private logger: DetailLogger;
  private defaultWeights: ScoringWeights;
  private defaultIndustry: string;
  private customSensitivePatterns?: SensitiveFieldPattern[];
  private customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;
  private autoNormalizeWeights: boolean;

  constructor(options?: {
    defaultWeights?: Partial<ScoringWeights>;
    defaultIndustry?: string;
    enableDetailLogByDefault?: boolean;
    customSensitiveFieldPatterns?: SensitiveFieldPattern[];
    customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;
    autoNormalizeWeights?: boolean;
  }) {
    this.logger = new DetailLogger(options?.enableDetailLogByDefault ?? false);
    this.defaultWeights = {
      ...DEFAULT_SCORING_WEIGHTS,
      ...(options?.defaultWeights || {}),
    };
    this.defaultIndustry = options?.defaultIndustry || 'general';
    this.customSensitivePatterns = options?.customSensitiveFieldPatterns;
    this.customIndustryConfigs = options?.customIndustryConfigs;
    this.autoNormalizeWeights = options?.autoNormalizeWeights ?? true;
  }

  score(input: ScoringInput): ScoringResult {
    this.logger.clear();
    const enableDetailLog = input.enableDetailLog ?? false;
    this.logger.setEnabled(enableDetailLog);

    this.logger.info('ScoringEngine', `开始评分，产品ID: ${input.productId}`);

    const rawCustomWeights = input.customWeights || {};
    const weightValidation = validateAndNormalizeWeights(
      rawCustomWeights,
      this.defaultWeights,
      this.autoNormalizeWeights
    );
    const weights = weightValidation.normalizedWeights;

    if (weightValidation.warnings.length > 0) {
      for (const warning of weightValidation.warnings) {
        this.logger.warn('ScoringEngine', `权重配置警告: ${warning}`);
      }
    }

    const industry = input.industry || this.defaultIndustry || 'general';
    const industryConfig = getIndustryConfig(industry, this.customIndustryConfigs);

    this.logger.debug('ScoringEngine', '评分配置', {
      industry,
      industryConfig: industryConfig.description,
      industryConfigVersion: industryConfig.version,
      originalWeights: { ...this.defaultWeights, ...rawCustomWeights },
      normalizedWeights: weights,
      weightsNormalized: weightValidation.wasNormalized,
    });

    const fieldValidator = new FieldCompletenessValidator(this.logger, this.customIndustryConfigs);
    const sampleValidator = new SampleCompletenessValidator(this.logger);
    const sensitiveRecognizer = new SensitiveFieldRecognizer(this.logger, this.customSensitivePatterns);
    const updateFrequencyScorer = new UpdateFrequencyScorer(this.logger);
    const descriptionValidator = new DescriptionCompletenessValidator(this.logger);
    const authValidator = new AuthorizationValidator(this.logger);

    const fieldResult = fieldValidator.validate(input.fields, industry);
    const sampleResult = sampleValidator.validate(input.sample);
    const sensitiveResult = sensitiveRecognizer.recognize(input.fields, input.authorization);
    const updateResult = updateFrequencyScorer.score(input.description);
    const descriptionResult = descriptionValidator.validate(input.description);
    const authResult = authValidator.validate(input.authorization);

    const allRisks: RiskItem[] = [
      ...fieldResult.risks,
      ...sampleResult.risks,
      ...sensitiveResult.risks,
      ...updateResult.risks,
      ...descriptionResult.risks,
      ...authResult.risks,
    ];

    if (weightValidation.warnings.length > 0) {
      allRisks.push({
        id: 'weight-config-warning',
        category: 'weight_config',
        level: weightValidation.wasNormalized ? 'low' : 'medium',
        message: `权重配置存在 ${weightValidation.warnings.length} 项问题，${weightValidation.wasNormalized ? '已自动处理' : '需注意'}`,
        suggestion: '建议检查并修正权重配置，确保所有权重为非负数字且总和等于 100',
        evidence: weightValidation.warnings.map((w, idx) => ({
          type: 'weight' as const,
          description: `权重问题 #${idx + 1}`,
          value: w,
        })),
      });
    }

    const sortedRisks = this.sortRisksByLevel(allRisks);

    const dimScores = [
      { key: 'fieldCompleteness' as const, score: fieldResult.result.score },
      { key: 'sampleCompleteness' as const, score: sampleResult.result.score },
      { key: 'sensitiveField' as const, score: sensitiveResult.result.score },
      { key: 'updateFrequency' as const, score: updateResult.result.score },
      { key: 'descriptionCompleteness' as const, score: descriptionResult.result.score },
      { key: 'authorization' as const, score: authResult.result.score },
    ];

    let rawTotalScore = 0;
    for (const dim of dimScores) {
      const safeDimScore = isFinite(dim.score) && !isNaN(dim.score) ? dim.score : 0;
      const safeWeight = isFinite(weights[dim.key]) && !isNaN(weights[dim.key]) ? weights[dim.key] : 0;
      rawTotalScore += (safeDimScore / 100) * safeWeight;
    }

    const totalWeight =
      weights.fieldCompleteness +
      weights.sampleCompleteness +
      weights.sensitiveField +
      weights.updateFrequency +
      weights.descriptionCompleteness +
      weights.authorization;

    const safeTotalWeight = isFinite(totalWeight) && !isNaN(totalWeight) && totalWeight > 0 ? totalWeight : 100;
    const totalScore = clampScore(rawTotalScore, 0, safeTotalWeight);
    const normalizedTotalWeight = clampScore(safeTotalWeight, 1, 1000);

    const grade = this.calculateGrade(totalScore, normalizedTotalWeight);
    const suggestions = this.generateSuggestions(sortedRisks, grade);

    this.logger.debug('ScoringEngine', '评分结果汇总', {
      rawTotalScore,
      totalScore,
      totalWeight: normalizedTotalWeight,
      grade,
      riskCount: sortedRisks.length,
    });

    const result: ScoringResult = {
      productId: input.productId,
      totalScore,
      maxScore: normalizedTotalWeight,
      grade,
      dimensionScores: {
        fieldCompleteness: fieldResult.result,
        sampleCompleteness: sampleResult.result,
        sensitiveField: sensitiveResult.result,
        updateFrequency: updateResult.result,
        descriptionCompleteness: descriptionResult.result,
        authorization: authResult.result,
      },
      risks: sortedRisks,
      suggestions,
      detailLogs: enableDetailLog ? this.logger.getLogs() : undefined,
      weightWarnings: weightValidation.warnings.length > 0 ? weightValidation.warnings : undefined,
      metadata: {
        scoredAt: new Date().toISOString(),
        industry,
        weights,
        originalWeights: weightValidation.wasNormalized
          ? { ...this.defaultWeights, ...rawCustomWeights }
          : undefined,
        weightsNormalized: weightValidation.wasNormalized,
        industryConfigVersion: industryConfig.version,
        industryConfigDescription: industryConfig.description,
      },
    };

    this.logger.info('ScoringEngine', `评分完成，产品ID: ${input.productId}，总分: ${totalScore}/${normalizedTotalWeight}，等级: ${grade}`);

    return result;
  }

  private sortRisksByLevel(risks: RiskItem[]): RiskItem[] {
    const levelOrder: Record<RiskLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return [...risks].sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
  }

  private calculateGrade(score: number, maxScore: number): QualityGrade {
    const safeMax = maxScore > 0 ? maxScore : 100;
    const percentage = safePercentage(score, safeMax);

    for (const threshold of GRADE_THRESHOLDS) {
      if (percentage >= threshold.minScore) {
        return threshold.grade as QualityGrade;
      }
    }

    return 'D';
  }

  private generateSuggestions(risks: RiskItem[], grade: QualityGrade): string[] {
    const suggestions: string[] = [];

    const criticalRisks = risks.filter((r) => r.level === 'critical');
    const highRisks = risks.filter((r) => r.level === 'high');
    const mediumRisks = risks.filter((r) => r.level === 'medium');

    if (criticalRisks.length > 0) {
      suggestions.push(`立即处理 ${criticalRisks.length} 个严重风险项，这些问题可能导致数据产品无法通过上架审核`);
    }

    if (highRisks.length > 0) {
      suggestions.push(`优先修复 ${highRisks.length} 个高风险项，这些问题会显著影响数据质量评分`);
    }

    if (mediumRisks.length > 0) {
      suggestions.push(`建议改进 ${mediumRisks.length} 个中等风险项，以进一步提升数据产品质量`);
    }

    if (grade === 'S' || grade === 'A') {
      suggestions.push('数据质量良好，请继续保持并建立持续的数据质量监控机制');
    } else if (grade === 'B') {
      suggestions.push('数据质量基本达标，建议针对风险项进行优化以达到优秀水平');
    } else if (grade === 'C') {
      suggestions.push('数据质量存在较多问题，建议进行全面整改后再提交上架审核');
    } else {
      suggestions.push('数据质量严重不达标，需进行系统性的数据治理和质量提升工作');
    }

    return suggestions;
  }
}
