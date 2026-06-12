import { SampleSummary, SampleCompletenessResult, RiskItem } from '../types';
import { HIGH_MISSING_RATE_THRESHOLD, clampScore, safePercentage } from '../config';
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
    const fieldMissingDetails: Record<string, { missing: number; total: number; rate: number }> = {};

    let totalFieldCount = 0;
    let totalNonNullCount = 0;

    for (const [fieldName, fieldStats] of Object.entries(sample.fieldValues)) {
      const fieldTotal = sample.totalRecords;
      const nonNullCount = fieldStats.nonNullCount ?? 0;
      const nullCount = fieldStats.nullCount ?? (fieldTotal - nonNullCount);
      const completionRate = fieldTotal > 0 ? nonNullCount / fieldTotal : 0;
      const safeRate = isFinite(completionRate) && !isNaN(completionRate) ? completionRate : 0;

      fieldCompletionRates[fieldName] = Math.round(safeRate * 10000) / 10000;

      totalFieldCount += fieldTotal;
      totalNonNullCount += nonNullCount;

      const missingRate = 1 - safeRate;
      if (missingRate >= HIGH_MISSING_RATE_THRESHOLD) {
        fieldsWithHighMissingRate.push(fieldName);
        fieldMissingDetails[fieldName] = {
          missing: nullCount,
          total: fieldTotal,
          rate: missingRate,
        };
        this.logger.warn('SampleCompletenessValidator', `字段 ${fieldName} 缺失率过高: ${(missingRate * 100).toFixed(2)}%`);
      }
    }

    const overallCompletionRate =
      totalFieldCount > 0 ? totalNonNullCount / totalFieldCount : 0;
    const safeOverallRate = isFinite(overallCompletionRate) && !isNaN(overallCompletionRate) ? overallCompletionRate : 0;

    let score = 0;
    if (sample.totalRecords === 0) {
      score = 0;
      risks.push({
        id: 'sample-no-data',
        category: 'sample_completeness',
        level: 'critical',
        message: '样本数据为空，无任何记录',
        suggestion: '请提供有效的样本数据，至少包含一定数量的记录',
        evidence: [
          {
            type: 'count',
            description: '样本记录数',
            value: 0,
            expected: '至少 100 条记录以保证统计有效性',
          },
        ],
      });
    } else {
      const sampleSizeScore = this.calculateSampleSizeScore(sample.totalRecords);
      const completenessScore = safeOverallRate * 60;
      const highMissingPenalty = Math.min(fieldsWithHighMissingRate.length * 5, 20);

      const rawScore = sampleSizeScore * 0.4 + completenessScore - highMissingPenalty;
      score = clampScore(rawScore);
    }

    this.logger.debug('SampleCompletenessValidator', '样本完整性评分详情', {
      overallCompletionRate: safeOverallRate,
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
        evidence: [
          {
            type: 'count',
            description: '当前样本记录数',
            value: sample.totalRecords,
            expected: '>= 100 条（推荐 >= 1000 条）',
          },
        ],
      });
    } else if (sample.totalRecords > 0 && sample.totalRecords < 100) {
      risks.push({
        id: 'sample-insufficient',
        category: 'sample_completeness',
        level: 'medium',
        message: `样本记录数较少，仅有 ${sample.totalRecords} 条`,
        suggestion: '建议增加样本数据量以获得更准确的质量评估',
        evidence: [
          {
            type: 'count',
            description: '当前样本记录数',
            value: sample.totalRecords,
            expected: '>= 100 条',
          },
        ],
      });
    }

    if (fieldsWithHighMissingRate.length > 0) {
      const evidence = fieldsWithHighMissingRate.map((f) => {
        const d = fieldMissingDetails[f];
        return {
          type: 'sample_rate' as const,
          description: `字段 ${f} 的缺失情况`,
          fields: [f],
          value: `缺失 ${d.missing}/${d.total} 条，缺失率 ${safePercentage(d.rate * 100, 100)}%`,
          expected: `缺失率应低于 ${safePercentage(HIGH_MISSING_RATE_THRESHOLD * 100, 100)}%`,
        };
      });

      risks.push({
        id: 'sample-high-missing-rate',
        category: 'sample_completeness',
        level: fieldsWithHighMissingRate.length >= 5 ? 'high' : 'medium',
        message: `${fieldsWithHighMissingRate.length} 个字段缺失率超过 ${safePercentage(HIGH_MISSING_RATE_THRESHOLD * 100, 0)}%: ${fieldsWithHighMissingRate.join(', ')}`,
        suggestion: `请检查数据采集和处理流程，对高缺失率字段进行补充或移除: ${fieldsWithHighMissingRate.join(', ')}`,
        relatedFields: fieldsWithHighMissingRate,
        evidence: [
          {
            type: 'count',
            description: '高缺失率字段数量',
            value: fieldsWithHighMissingRate.length,
            expected: 0,
          },
          ...evidence,
        ],
      });
    }

    const result: SampleCompletenessResult = {
      score,
      maxScore: 100,
      overallCompletionRate: Math.round(safeOverallRate * 10000) / 10000,
      fieldCompletionRates,
      fieldsWithHighMissingRate,
      totalSampleRecords: sample.totalRecords,
    };

    this.logger.info('SampleCompletenessValidator', `样本完整性校验完成，得分: ${score}/100`);

    return { result, risks };
  }

  private calculateSampleSizeScore(totalRecords: number): number {
    if (!isFinite(totalRecords) || isNaN(totalRecords) || totalRecords <= 0) return 0;
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
