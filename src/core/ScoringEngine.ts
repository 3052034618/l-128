import {
  ScoringInput,
  ScoringResult,
  ScoringWeights,
  QualityGrade,
  RiskItem,
  RiskLevel,
  IndustryRequiredFieldsConfig,
  RuleFallbackInfo,
  ZeroWeightDimension,
  IndustryType,
} from '../types';
import {
  DEFAULT_SCORING_WEIGHTS,
  GRADE_THRESHOLDS,
  validateAndNormalizeWeights,
  clampScore,
  safePercentage,
  SensitiveFieldPattern,
  getIndustryConfig,
  DIMENSION_NAMES,
} from '../config';
import { DetailLogger } from './logger';
import { IndustryRuleRegistry } from './IndustryRuleRegistry';
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
  private handleZeroWeightAs: 'exclude' | 'normalize' | 'warn';
  private defaultVersion?: string;
  private usePublishedRulesOnly: boolean;
  private allowTrialRules: boolean;
  private ruleRegistry: IndustryRuleRegistry;

  constructor(options?: {
    defaultWeights?: Partial<ScoringWeights>;
    defaultIndustry?: string;
    enableDetailLogByDefault?: boolean;
    customSensitiveFieldPatterns?: SensitiveFieldPattern[];
    customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;
    autoNormalizeWeights?: boolean;
    handleZeroWeightAs?: 'exclude' | 'normalize' | 'warn';
    defaultIndustryConfigVersion?: string;
    auditPassThreshold?: number;
    usePublishedRulesOnly?: boolean;
    allowTrialRules?: boolean;
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
    this.handleZeroWeightAs = options?.handleZeroWeightAs ?? 'warn';
    this.defaultVersion = options?.defaultIndustryConfigVersion;
    this.usePublishedRulesOnly = options?.usePublishedRulesOnly ?? true;
    this.allowTrialRules = options?.allowTrialRules ?? false;
    this.ruleRegistry = IndustryRuleRegistry.getInstance();

    if (this.customIndustryConfigs) {
      for (const [industry, config] of Object.entries(this.customIndustryConfigs)) {
        const version = config.version || 'custom';
        if (!this.ruleRegistry.hasRule(industry, version)) {
          this.ruleRegistry.registerRule(industry, version, config, {
            source: 'override',
            setAsDefault: !this.ruleRegistry.getDefaultVersion(industry),
          });
        }
      }
    }
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
      this.autoNormalizeWeights,
      this.handleZeroWeightAs
    );
    const weights = weightValidation.normalizedWeights;
    const zeroWeightDimensions: ZeroWeightDimension[] = weightValidation.zeroWeightDimensions || [];

    if (weightValidation.warnings.length > 0) {
      for (const warning of weightValidation.warnings) {
        this.logger.warn('ScoringEngine', `权重配置警告: ${warning}`);
      }
    }

    const industry = (input.industry || this.defaultIndustry || 'general') as IndustryType;
    const requestedVersion = input.industryConfigVersion || this.defaultVersion;

    let ruleFallbackInfo: RuleFallbackInfo | undefined;
    let industryConfig = getIndustryConfig(industry, this.customIndustryConfigs);

    try {
      const registryResult = this.ruleRegistry.getRuleWithFallbackInfo(
        industry,
        requestedVersion,
        {
          defaultIndustry: 'general' as IndustryType,
          allowTrial: this.allowTrialRules,
          allowDeprecated: false,
          allowDraft: false,
        }
      );
      industryConfig = {
        ...registryResult.config,
        key: registryResult.config.industry,
      };
      ruleFallbackInfo = registryResult.fallbackInfo;
      if (ruleFallbackInfo) {
        this.logger.warn('ScoringEngine', `规则回退: ${ruleFallbackInfo.reason}`);
      }
    } catch (e: any) {
      this.logger.warn('ScoringEngine', `规则注册中心查询失败，使用 fallback: ${e.message}`);
    }

    this.logger.debug('ScoringEngine', '评分配置', {
      industry,
      requestedVersion,
      industryConfig: industryConfig.description,
      industryConfigVersion: industryConfig.version,
      industryConfigSource: industryConfig.source,
      fallbackReason: ruleFallbackInfo?.reason,
      originalWeights: { ...this.defaultWeights, ...rawCustomWeights },
      normalizedWeights: weights,
      weightsNormalized: weightValidation.wasNormalized,
      zeroWeightDimensions: zeroWeightDimensions.map((z) => `${z.dimensionName}=0, strategy=${z.handlingStrategy}`),
    });

    const fieldValidator = new FieldCompletenessValidator(this.logger, this.customIndustryConfigs);
    const sampleValidator = new SampleCompletenessValidator(this.logger);
    const sensitiveRecognizer = new SensitiveFieldRecognizer(this.logger, this.customSensitivePatterns);
    const updateFrequencyScorer = new UpdateFrequencyScorer(this.logger);
    const descriptionValidator = new DescriptionCompletenessValidator(this.logger);
    const authValidator = new AuthorizationValidator(this.logger);

    const fieldResult = fieldValidator.validate(input.fields, industry, requestedVersion, {
      allowTrial: this.allowTrialRules,
      allowDraft: false,
      allowDeprecated: false,
    });
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

    if (ruleFallbackInfo) {
      allRisks.push({
        id: 'rule-fallback-warning',
        category: 'rule_config',
        level: 'low',
        message: `行业规则发生回退: ${ruleFallbackInfo.reason}`,
        suggestion: '建议检查行业配置和版本号是否正确，或在规则注册中心补充对应的规则版本',
        evidence: [
          {
            type: 'config',
            description: '请求的规则参数',
            value: `行业=${ruleFallbackInfo.requestedIndustry || industry}, 版本=${ruleFallbackInfo.requestedVersion || '默认'}`,
          },
          {
            type: 'config',
            description: '实际使用的规则',
            value: `行业=${ruleFallbackInfo.fallbackIndustry}, 版本=${ruleFallbackInfo.fallbackVersion}`,
          },
          {
            type: 'value',
            description: '回退原因',
            value: ruleFallbackInfo.reason,
          },
        ],
      });
    }

    if (zeroWeightDimensions.length > 0) {
      const explicitZeros = zeroWeightDimensions.filter((z) => z.isExplicitlyZero);
      if (explicitZeros.length > 0) {
        allRisks.push({
          id: 'zero-weight-warning',
          category: 'weight_config',
          level: 'low',
          message: `有 ${explicitZeros.length} 个维度权重被显式设为 0，这些维度不影响总分`,
          suggestion: '请确认是否有意将这些维度排除在评分之外，如需参与评分请设置正数值权重',
          evidence: explicitZeros.map((z, idx) => ({
            type: 'weight' as const,
            description: `零权重维度 #${idx + 1}`,
            value: `${z.dimensionName} (${z.dimensionKey})`,
            expected: z.note,
          })),
        });
      }
    }

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
    let effectiveWeightSum = 0;
    for (const dim of dimScores) {
      const safeDimScore = isFinite(dim.score) && !isNaN(dim.score) ? dim.score : 0;
      const safeWeight = isFinite(weights[dim.key]) && !isNaN(weights[dim.key]) ? weights[dim.key] : 0;
      const isZeroWeight = zeroWeightDimensions.some(
        (z) => z.dimensionKey === dim.key && z.handlingStrategy === 'exclude'
      );
      if (!isZeroWeight) {
        rawTotalScore += (safeDimScore / 100) * safeWeight;
        effectiveWeightSum += safeWeight;
      }
    }

    const totalWeight = effectiveWeightSum > 0 ? effectiveWeightSum : 100;
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
      zeroWeightDimensions: zeroWeightDimensions.length > 0 ? zeroWeightDimensions : undefined,
      ruleFallbackInfo,
      metadata: {
        scoredAt: new Date().toISOString(),
        industry,
        weights,
        originalWeights: weightValidation.wasNormalized || zeroWeightDimensions.length > 0
          ? { ...this.defaultWeights, ...rawCustomWeights }
          : undefined,
        weightsNormalized: weightValidation.wasNormalized,
        industryConfigVersion: industryConfig.version,
        industryConfigDescription: industryConfig.description,
        industryConfigSource: (industryConfig as any).source || 'built-in',
        industryConfigStatus: (industryConfig as any).status,
        industryConfigEffectiveAt: (industryConfig as any).publishedAt || (industryConfig as any).effectiveAt,
        industryConfigRegisteredAt: (industryConfig as any).registeredAt,
        industryConfigPublishedAt: (industryConfig as any).publishedAt,
        industryConfigTrialStartAt: (industryConfig as any).trialStartAt,
        industryConfigTrialEndAt: (industryConfig as any).trialEndAt,
        industryConfigDeprecatedAt: (industryConfig as any).deprecatedAt,
        industryConfigIsOverridden: (industryConfig as any).source === 'override',
        industryConfigIsDefault: (industryConfig as any).version === this.ruleRegistry.getDefaultVersion(industry),
        industryConfigChangeLog: (industryConfig as any).changeLog,
        ruleFallbackReason: ruleFallbackInfo?.reason,
        ruleFallbackInfo,
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
