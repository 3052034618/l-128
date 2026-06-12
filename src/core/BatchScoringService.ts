import { BatchScoringInput, BatchScoringResult, ScoringResult, QualityGrade } from '../types';
import { ScoringEngine } from './ScoringEngine';
import { DetailLogger } from './logger';
import { SDKOptions } from '../types';

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
    });
    this.logger = new DetailLogger(options?.enableDetailLogByDefault ?? false);
  }

  scoreBatch(input: BatchScoringInput): BatchScoringResult {
    this.logger.info('BatchScoringService', `开始批量评分，共 ${input.items.length} 个数据产品`);

    const results: ScoringResult[] = [];
    const globalOptions = input.globalOptions || {};

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      const mergedItem = {
        ...item,
        industry: item.industry || globalOptions.industry,
        customWeights: { ...globalOptions.customWeights, ...item.customWeights },
        enableDetailLog: item.enableDetailLog ?? globalOptions.enableDetailLog,
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
      totalScore += result.totalScore / result.maxScore;
    }

    const averageScore = results.length > 0 ? totalScore / results.length : 0;

    this.logger.info('BatchScoringService', `批量评分完成，成功评分 ${results.length} 个产品`);

    return {
      results,
      summary: {
        totalItems: results.length,
        gradeDistribution,
        averageScore,
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
      const results: ScoringResult[] = [];
      let currentIndex = 0;
      let completed = 0;
      const total = input.items.length;
      let hasError = false;

      const processNext = () => {
        if (hasError) return;

        if (completed >= total) {
          const gradeDistribution: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
          let totalScore = 0;
          for (const result of results) {
            gradeDistribution[result.grade]++;
            totalScore += result.totalScore / result.maxScore;
          }
          const averageScore = results.length > 0 ? totalScore / results.length : 0;

          resolve({
            results,
            summary: {
              totalItems: results.length,
              gradeDistribution,
              averageScore,
            },
          });
          return;
        }

        while (currentIndex < total && results.filter(() => true).length - completed < concurrency) {
          const idx = currentIndex++;
          const item = input.items[idx];
          const mergedItem = {
            ...item,
            industry: item.industry || globalOptions.industry,
            customWeights: { ...globalOptions.customWeights, ...item.customWeights },
            enableDetailLog: item.enableDetailLog ?? globalOptions.enableDetailLog,
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
}
