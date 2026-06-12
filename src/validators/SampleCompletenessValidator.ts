import { SampleSummary, SampleCompletenessResult, RiskItem } from '../types';
import { HIGH_MISSING_RATE_THRESHOLD } from '../config';
import { DetailLogger } from '../core/logger';

export class SampleCompletenessValidator {
  private logger: DetailLogger;

  constructor(logger: DetailLogger) {
    this.logger = logger;
  }

  validate(sample: SampleSummary): { result: SampleCompletenessResult; risks: RiskItem[] } {
    this.logger.info('SampleCompletenessValidator', `开始校验样本完整性，总记录数: ${sample.totalRecords}`);

    const risks: RiskItem[] = [];
    const fieldCompletionRates: Record<string, number> = {};
    const fieldsWithHighMissingRate: string[] = [];

    let totalFieldCount = 0;
    let totalNonNullCount = 0;

    for (const [fieldName, fieldStats] of Object.entries(sample.fieldValues)) {
      const fieldTotal = sample.totalRecords;
      const nonNullCount = fieldStats.nonNullCount ?? 0;
      const nullCount = fieldStats.nullCount ?? (fieldTotal - nonNullCount);
      const completionRate = fieldTotal > 0 ? nonNullCount / fieldTotal : 0;

      fieldCompletionRates[fieldName] = Math.round(completionRate * 10000) / 10000;

      totalFieldCount += fieldTotal;
      totalNonNullCount += nonNullCount;

      const missingRate = 1 - completionRate;
      if (missingRate >= HIGH_MISSING_RATE_THRESHOLD) {
        fieldsWithHighMissingRate.push(fieldName);
        this.logger.warn('SampleCompletenessValidator', `字段 ${fieldName} 缺失率过高: ${(missingRate * 100).toFixed(2)}%`);
      }
    }

    const overallCompletionRate =
      totalFieldCount > 0 ? totalNonNullCount / totalFieldCount : 0;

    let score = 0;
    if (sample.totalRecords === 0) {
      score = 0;
      risks.push({
        id: 'sample-no-data',
        category: 'sample_completeness',
        level: 'critical',
        message: '样本数据为空，无任何记录',
        suggestion: '请提供有效的样本数据，至少包含一定数量的记录',
      });
    } else {
      const sampleSizeScore = this.calculateSampleSizeScore(sample.totalRecords);
      const completenessScore = overallCompletionRate * 60;
      const highMissingPenalty = Math.min(fieldsWithHighMissingRate.length * 5, 20);

      score = Math.max(0, Math.round(sampleSizeScore * 0.4 + completenessScore - highMissingPenalty));
      score = Math.min(100, score);
    }

    this.logger.debug('SampleCompletenessValidator', '样本完整性评分详情', {
      overallCompletionRate,
      fieldsWithHighMissingRate,
      finalScore: score,
    });

    if (sample.totalRecords > 0 && sample.totalRecords < 10) {
      risks.push({
        id: 'sample-too-few',
        category: 'sample_completeness',
        level: 'high',
        message: `样本记录数过少，仅 ${sample.totalRecords} 条`,
        suggestion: '建议增加样本数据量，至少提供 100 条以上的记录以保证统计有效性',
      });
    } else if (sample.totalRecords > 0 && sample.totalRecords < 100) {
      risks.push({
        id: 'sample-insufficient',
        category: 'sample_completeness',
        level: 'medium',
        message: `样本记录数较少，仅有 ${sample.totalRecords} 条`,
        suggestion: '建议增加样本数据量以获得更准确的质量评估',
      });
    }

    if (fieldsWithHighMissingRate.length > 0) {
      risks.push({
        id: 'sample-high-missing-rate',
        category: 'sample_completeness',
        level: fieldsWithHighMissingRate.length >= 5 ? 'high' : 'medium',
        message: `${fieldsWithHighMissingRate.length} 个字段缺失率超过 ${(HIGH_MISSING_RATE_THRESHOLD * 100).toFixed(0)}%: ${fieldsWithHighMissingRate.join(', ')}`,
        suggestion: `请检查数据采集和处理流程，对高缺失率字段进行补充或移除: ${fieldsWithHighMissingRate.join(', ')}`,
        relatedFields: fieldsWithHighMissingRate,
      });
    }

    const result: SampleCompletenessResult = {
      score,
      maxScore: 100,
      overallCompletionRate: Math.round(overallCompletionRate * 10000) / 10000,
      fieldCompletionRates,
      fieldsWithHighMissingRate,
      totalSampleRecords: sample.totalRecords,
    };

    this.logger.info('SampleCompletenessValidator', `样本完整性校验完成，得分: ${score}/100`);

    return { result, risks };
  }

  private calculateSampleSizeScore(totalRecords: number): number {
    if (totalRecords >= 10000) return 100;
    if (totalRecords >= 5000) return 90;
    if (totalRecords >= 1000) return 80;
    if (totalRecords >= 500) return 70;
    if (totalRecords >= 100) return 60;
    if (totalRecords >= 50) return 50;
    if (totalRecords >= 10) return 30;
    return 10;
  }
}
