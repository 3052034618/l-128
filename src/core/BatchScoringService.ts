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
} from '../types';
import { ScoringEngine } from './ScoringEngine';
import { DetailLogger } from './logger';
import { LOW_SCORE_THRESHOLD, safePercentage } from '../config';

interface RiskAccumulator {
  id: string;
  message: string;
  level: RiskLevel;
  category: string;
  count: number;
  products: string[];
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

    this.logger.info('BatchScoringService', `批量评分完成，成功评分 ${results.length} 个产品`);

    return {
      results,
      summary: {
        totalItems: results.length,
        gradeDistribution,
        averageScore,
        highFrequencyRisks,
        lowScoringDimensions,
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

        resolve({
          results,
          summary: {
            totalItems: results.length,
            gradeDistribution,
            averageScore,
            highFrequencyRisks,
            lowScoringDimensions,
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
    const minOccurrence = Math.max(2, Math.floor(results.length * 0.2));

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
      .filter((r) => r.count >= minOccurrence)
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
}
