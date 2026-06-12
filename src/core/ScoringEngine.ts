import {
  ScoringInput,
  ScoringResult,
  ScoringWeights,
  QualityGrade,
  RiskItem,
  RiskLevel,
} from '../types';
import { DEFAULT_SCORING_WEIGHTS, GRADE_THRESHOLDS } from '../config';
import { DetailLogger } from './logger';
import { FieldCompletenessValidator } from '../validators/FieldCompletenessValidator';
import { SampleCompletenessValidator } from '../validators/SampleCompletenessValidator';
import { SensitiveFieldRecognizer } from '../validators/SensitiveFieldRecognizer';
import { UpdateFrequencyScorer } from '../validators/UpdateFrequencyScorer';
import { DescriptionCompletenessValidator } from '../validators/DescriptionCompletenessValidator';
import { AuthorizationValidator } from '../validators/AuthorizationValidator';
import { SensitiveFieldPattern } from '../config';

export class ScoringEngine {
  private logger: DetailLogger;
  private defaultWeights: ScoringWeights;
  private defaultIndustry: string;
  private customSensitivePatterns?: SensitiveFieldPattern[];
  private customIndustryConfigs?: Record<string, any>;

  constructor(options?: {
    defaultWeights?: Partial<ScoringWeights>;
    defaultIndustry?: string;
    enableDetailLogByDefault?: boolean;
    customSensitiveFieldPatterns?: SensitiveFieldPattern[];
    customIndustryConfigs?: Record<string, any>;
  }) {
    this.logger = new DetailLogger(options?.enableDetailLogByDefault ?? false);
    this.defaultWeights = {
      ...DEFAULT_SCORING_WEIGHTS,
      ...(options?.defaultWeights || {}),
    };
    this.defaultIndustry = options?.defaultIndustry || 'general';
    this.customSensitivePatterns = options?.customSensitiveFieldPatterns;
    this.customIndustryConfigs = options?.customIndustryConfigs;
  }

  score(input: ScoringInput): ScoringResult {
    this.logger.clear();
    const enableDetailLog = input.enableDetailLog ?? false;
    this.logger.setEnabled(enableDetailLog);

    this.logger.info('ScoringEngine', `开始评分，产品ID: ${input.productId}`);

    const weights: ScoringWeights = {
      ...this.defaultWeights,
      ...(input.customWeights || {}),
    };

    const industry = input.industry || (this.defaultIndustry as any) || 'general';

    this.logger.debug('ScoringEngine', '评分配置', { industry, weights });

    const fieldValidator = new FieldCompletenessValidator(this.logger);
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

    const sortedRisks = this.sortRisksByLevel(allRisks);

    const weightedScores = {
      fieldCompleteness: (fieldResult.result.score / 100) * weights.fieldCompleteness,
      sampleCompleteness: (sampleResult.result.score / 100) * weights.sampleCompleteness,
      sensitiveField: (sensitiveResult.result.score / 100) * weights.sensitiveField,
      updateFrequency: (updateResult.result.score / 100) * weights.updateFrequency,
      descriptionCompleteness: (descriptionResult.result.score / 100) * weights.descriptionCompleteness,
      authorization: (authResult.result.score / 100) * weights.authorization,
    };

    const totalWeight =
      weights.fieldCompleteness +
      weights.sampleCompleteness +
      weights.sensitiveField +
      weights.updateFrequency +
      weights.descriptionCompleteness +
      weights.authorization;

    const totalScore = Math.round(
      Object.values(weightedScores).reduce((sum, s) => sum + s, 0)
    );

    const grade = this.calculateGrade(totalScore, totalWeight);

    const suggestions = this.generateSuggestions(sortedRisks, grade);

    this.logger.debug('ScoringEngine', '评分结果汇总', {
      weightedScores,
      totalScore,
      totalWeight,
      grade,
      riskCount: sortedRisks.length,
    });

    const result: ScoringResult = {
      productId: input.productId,
      totalScore,
      maxScore: totalWeight,
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
      metadata: {
        scoredAt: new Date().toISOString(),
        industry,
        weights,
      },
    };

    this.logger.info('ScoringEngine', `评分完成，产品ID: ${input.productId}，总分: ${totalScore}/${totalWeight}，等级: ${grade}`);

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
    const percentage = (score / maxScore) * 100;

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
