import {
  BatchScoringInput,
  BatchScoringResult,
  ScoringResult,
  QualityGrade,
  HighFrequencyRisk,
  LowScoringDimension,
  ScoringWeights,
  RiskLevel,
  SDKOptions,
  BatchGroupSummary,
  RiskItem,
  IndustryType,
} from '../types';
import { ScoringEngine } from './ScoringEngine';
import { DetailLogger } from './logger';
import { LOW_SCORE_THRESHOLD, safePercentage, DIMENSION_NAMES } from '../config';

interface RiskAccumulator {
  id: string;
  message: string;
  level: RiskLevel;
  category: string;
  count: number;
  products: string[];
}

interface GroupAccumulator {
  groupKey: string;
  groupName: string;
  results: ScoringResult[];
}

export class BatchScoringService {
  private engine: ScoringEngine;
  private logger: DetailLogger;

  constructor(options?: SDKOptions) {
    this.engine = new ScoringEngine({
      defaultWeights: options?.defaultWeights,
      defaultIndustry: options?.defaultIndustry,
      enableDetailLogByDefault: options?.enableDetailLogByDefault,
      customSensitiveFieldPatterns: options?.customSensitiveFieldPatterns,
      customIndustryConfigs: options?.customIndustryConfigs,
      autoNormalizeWeights: options?.autoNormalizeWeights,
      handleZeroWeightAs: options?.handleZeroWeightAs,
      auditPassThreshold: options?.auditPassThreshold,
      usePublishedRulesOnly: options?.usePublishedRulesOnly,
      allowTrialRules: options?.allowTrialRules,
    });
    this.logger = new DetailLogger(options?.enableDetailLogByDefault ?? false);
  }

  scoreBatch(input: BatchScoringInput): BatchScoringResult {
    this.logger.info('BatchScoringService', `开始批量评分，共 ${input.items.length} 个数据产品`);

    const results: ScoringResult[] = [];
    const globalOptions = input.globalOptions || {};
    const autoNormalize = input.autoNormalizeWeights ?? globalOptions.autoNormalizeWeights ?? true;

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      const mergedItem = {
        ...item,
        industry: item.industry || globalOptions.industry,
        customWeights: { ...globalOptions.customWeights, ...item.customWeights },
        enableDetailLog: item.enableDetailLog ?? globalOptions.enableDetailLog,
        industryConfigVersion: item.industryConfigVersion || globalOptions.industryConfigVersion,
      };

      this.logger.debug('BatchScoringService', `正在评分第 ${i + 1}/${input.items.length} 个产品: ${mergedItem.productId}`);

      try {
        const result = this.engine.score(mergedItem);
        results.push(result);
      } catch (error: any) {
        this.logger.error('BatchScoringService', `评分产品 ${mergedItem.productId} 失败: ${error.message}`);
        throw new Error(`批量评分失败，产品 ${mergedItem.productId}: ${error.message}`);
      }
    }

    const gradeDistribution: Record<QualityGrade, number> = {
      S: 0,
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };

    let totalScore = 0;
    for (const result of results) {
      gradeDistribution[result.grade]++;
      totalScore += safePercentage(result.totalScore, result.maxScore) / 100;
    }

    const averageScore = results.length > 0 ? totalScore / results.length : 0;
    const highFrequencyRisks = this.aggregateHighFrequencyRisks(results);
    const lowScoringDimensions = this.aggregateLowScoringDimensions(results);
    const groupByIndustry = this.generateGroupByIndustry(results);
    const groupByGrade = this.generateGroupByGrade(results);
    const groupByCategory = this.generateGroupByCategory(results);

    this.logger.info('BatchScoringService', `批量评分完成，成功评分 ${results.length} 个产品`);

    return {
      results,
      summary: {
        totalItems: results.length,
        gradeDistribution,
        averageScore,
        highFrequencyRisks,
        lowScoringDimensions,
        groupByIndustry,
        groupByGrade,
        groupByCategory,
      },
    };
  }

  scoreBatchAsync(
    input: BatchScoringInput,
    options?: { concurrency?: number; onProgress?: (current: number, total: number) => void }
  ): Promise<BatchScoringResult> {
    return new Promise((resolve, reject) => {
      const concurrency = options?.concurrency || 1;
      const globalOptions = input.globalOptions || {};
      const autoNormalize = input.autoNormalizeWeights ?? globalOptions.autoNormalizeWeights ?? true;
      const results: ScoringResult[] = [];
      let currentIndex = 0;
      let completed = 0;
      const total = input.items.length;
      let hasError = false;

      const finalize = () => {
        const gradeDistribution: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
        let totalScore = 0;
        for (const result of results) {
          gradeDistribution[result.grade]++;
          totalScore += safePercentage(result.totalScore, result.maxScore) / 100;
        }
        const averageScore = results.length > 0 ? totalScore / results.length : 0;
        const highFrequencyRisks = this.aggregateHighFrequencyRisks(results);
        const lowScoringDimensions = this.aggregateLowScoringDimensions(results);
        const groupByIndustry = this.generateGroupByIndustry(results);
        const groupByGrade = this.generateGroupByGrade(results);
        const groupByCategory = this.generateGroupByCategory(results);

        resolve({
          results,
          summary: {
            totalItems: results.length,
            gradeDistribution,
            averageScore,
            highFrequencyRisks,
            lowScoringDimensions,
            groupByIndustry,
            groupByGrade,
            groupByCategory,
          },
        });
      };

      const processNext = () => {
        if (hasError) return;

        if (completed >= total) {
          finalize();
          return;
        }

        while (currentIndex < total && (currentIndex - completed) < concurrency) {
          const idx = currentIndex++;
          const item = input.items[idx];
          const mergedItem = {
            ...item,
            industry: item.industry || globalOptions.industry,
            customWeights: { ...globalOptions.customWeights, ...item.customWeights },
            enableDetailLog: item.enableDetailLog ?? globalOptions.enableDetailLog,
            industryConfigVersion: item.industryConfigVersion || globalOptions.industryConfigVersion,
          };

          setImmediate(() => {
            try {
              const result = this.engine.score(mergedItem);
              results[idx] = result;
              completed++;
              if (options?.onProgress) {
                options.onProgress(completed, total);
              }
              processNext();
            } catch (error: any) {
              hasError = true;
              reject(new Error(`批量评分失败，产品 ${mergedItem.productId}: ${error.message}`));
            }
          });
        }
      };

      processNext();
    });
  }

  private aggregateHighFrequencyRisks(results: ScoringResult[]): HighFrequencyRisk[] {
    const riskMap = new Map<string, RiskAccumulator>();
    const totalItems = results.length;

    for (const result of results) {
      for (const risk of result.risks) {
        if (risk.level === 'low') continue;
        const existing = riskMap.get(risk.id);
        if (existing) {
          existing.count++;
          if (!existing.products.includes(result.productId)) {
            existing.products.push(result.productId);
          }
        } else {
          riskMap.set(risk.id, {
            id: risk.id,
            message: risk.message,
            level: risk.level,
            category: risk.category,
            count: 1,
            products: [result.productId],
          });
        }
      }
    }

    const levelOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    return Array.from(riskMap.values())
      .filter((r) => r.count >= 1)
      .sort((a, b) => {
        if (levelOrder[a.level] !== levelOrder[b.level]) {
          return levelOrder[a.level] - levelOrder[b.level];
        }
        return b.count - a.count;
      })
      .slice(0, 10)
      .map((r) => ({
        id: r.id,
        message: r.message,
        level: r.level,
        category: r.category,
        occurrenceCount: r.count,
        occurrencePercentage: totalItems > 0 ? Math.round((r.count / totalItems) * 10000) / 100 : 0,
        affectedProducts: r.products,
      }));
  }

  private aggregateLowScoringDimensions(results: ScoringResult[]): LowScoringDimension[] {
    const dimensionInfo: Array<{
      key: keyof ScoringWeights;
      name: string;
      resultKey: keyof ScoringResult['dimensionScores'];
    }> = [
      { key: 'fieldCompleteness', name: '字段完整性', resultKey: 'fieldCompleteness' },
      { key: 'sampleCompleteness', name: '样本完整性', resultKey: 'sampleCompleteness' },
      { key: 'sensitiveField', name: '敏感字段', resultKey: 'sensitiveField' },
      { key: 'updateFrequency', name: '更新频率', resultKey: 'updateFrequency' },
      { key: 'descriptionCompleteness', name: '描述完整性', resultKey: 'descriptionCompleteness' },
      { key: 'authorization', name: '授权范围', resultKey: 'authorization' },
    ];

    const lowDimensions: LowScoringDimension[] = [];

    for (const dim of dimensionInfo) {
      let totalDimScore = 0;
      let belowThresholdCount = 0;
      const affectedProducts: string[] = [];

      for (const result of results) {
        const dimResult = result.dimensionScores[dim.resultKey];
        const pct = safePercentage(dimResult.score, dimResult.maxScore);
        totalDimScore += pct;
        if (pct < LOW_SCORE_THRESHOLD) {
          belowThresholdCount++;
          affectedProducts.push(result.productId);
        }
      }

      const averageScore = results.length > 0 ? totalDimScore / results.length : 0;
      if (belowThresholdCount > 0) {
        lowDimensions.push({
          dimension: dim.name,
          dimensionKey: dim.key,
          averageScore: Math.round(averageScore * 100) / 100,
          belowThresholdCount,
          affectedProducts,
        });
      }
    }

    return lowDimensions.sort((a, b) => a.averageScore - b.averageScore);
  }

  private buildGroupSummary(
    groupKey: string,
    groupName: string,
    results: ScoringResult[]
  ): BatchGroupSummary {
    const gradeDistribution: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    let totalScore = 0;

    for (const result of results) {
      gradeDistribution[result.grade]++;
      totalScore += safePercentage(result.totalScore, result.maxScore) / 100;
    }

    const averageScore = results.length > 0 ? totalScore / results.length : 0;
    const highFrequencyRisks = this.aggregateHighFrequencyRisks(results);
    const lowScoringDimensions = this.aggregateLowScoringDimensions(results);

    return {
      groupKey,
      groupName,
      totalItems: results.length,
      averageScore: Math.round(averageScore * 10000) / 100,
      gradeDistribution,
      highFrequencyRisks,
      lowScoringDimensions,
      productIds: results.map((r) => r.productId),
    };
  }

  private generateGroupByIndustry(results: ScoringResult[]): BatchGroupSummary[] {
    const industryMap = new Map<string, ScoringResult[]>();

    for (const result of results) {
      const industry = result.metadata.industry || 'unknown';
      if (!industryMap.has(industry)) {
        industryMap.set(industry, []);
      }
      industryMap.get(industry)!.push(result);
    }

    const industryNames: Record<string, string> = {
      finance: '金融',
      healthcare: '医疗',
      education: '教育',
      retail: '零售',
      transportation: '交通',
      government: '政务',
      manufacturing: '制造',
      general: '通用',
      unknown: '未知',
    };

    return Array.from(industryMap.entries())
      .map(([industry, items]) =>
        this.buildGroupSummary(industry, industryNames[industry] || industry, items)
      )
      .sort((a, b) => b.totalItems - a.totalItems);
  }

  private generateGroupByGrade(results: ScoringResult[]): BatchGroupSummary[] {
    const gradeMap = new Map<QualityGrade, ScoringResult[]>();

    for (const result of results) {
      if (!gradeMap.has(result.grade)) {
        gradeMap.set(result.grade, []);
      }
      gradeMap.get(result.grade)!.push(result);
    }

    const gradeNames: Record<QualityGrade, string> = {
      S: 'S级 - 优秀',
      A: 'A级 - 良好',
      B: 'B级 - 合格',
      C: 'C级 - 待改进',
      D: 'D级 - 不合格',
    };

    const gradeOrder: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];

    return gradeOrder
      .filter((grade) => gradeMap.has(grade))
      .map((grade) => this.buildGroupSummary(grade, gradeNames[grade], gradeMap.get(grade)!));
  }

  private generateGroupByCategory(results: ScoringResult[]): BatchGroupSummary[] {
    const categoryMap = new Map<string, ScoringResult[]>();

    for (const result of results) {
      const categories = new Set(result.risks.map((r) => r.category));
      if (categories.size === 0) {
        categories.add('无风险');
      }
      for (const category of categories) {
        if (!categoryMap.has(category)) {
          categoryMap.set(category, []);
        }
        if (!categoryMap.get(category)!.some((r) => r.productId === result.productId)) {
          categoryMap.get(category)!.push(result);
        }
      }
    }

    const categoryNames: Record<string, string> = {
      '字段完整性': '字段完整性风险',
      '样本完整性': '样本完整性风险',
      '敏感字段': '敏感字段风险',
      '更新频率': '更新频率风险',
      '描述完整性': '描述完整性风险',
      '授权范围': '授权范围风险',
      '无风险': '无风险项',
    };

    return Array.from(categoryMap.entries())
      .map(([category, items]) =>
        this.buildGroupSummary(category, categoryNames[category] || category, items)
      )
      .sort((a, b) => b.totalItems - a.totalItems);
  }
}
