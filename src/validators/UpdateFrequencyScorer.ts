import {
  UpdateFrequencyResult,
  DataProductDescription,
  UpdateFrequencyType,
  RiskItem,
} from '../types';
import { UPDATE_FREQUENCY_SCORES, clampScore, safePercentage } from '../config';
import { DetailLogger } from '../core/logger';

export class UpdateFrequencyScorer {
  private logger: DetailLogger;

  constructor(logger: DetailLogger) {
    this.logger = logger;
  }

  score(description: DataProductDescription | undefined): { result: UpdateFrequencyResult; risks: RiskItem[] } {
    this.logger.info('UpdateFrequencyScorer', '开始评估更新频率得分');

    const risks: RiskItem[] = [];
    const frequency = description?.updateFrequency ?? 'unknown';
    const isSpecified = frequency !== 'unknown';
    const rawLastUpdated = description?.lastUpdatedAt;
    const hasLastUpdated = !!rawLastUpdated && rawLastUpdated.trim().length > 0;

    let daysSinceLastUpdate: number | undefined;
    let hasInvalidLastUpdated = false;

    if (hasLastUpdated && rawLastUpdated) {
      const parsedDate = new Date(rawLastUpdated);
      const isValidDate = !isNaN(parsedDate.getTime()) && isFinite(parsedDate.getTime());

      if (isValidDate) {
        const now = new Date();
        const diffMs = now.getTime() - parsedDate.getTime();
        daysSinceLastUpdate = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (daysSinceLastUpdate < 0) {
          daysSinceLastUpdate = 0;
        }
      } else {
        hasInvalidLastUpdated = true;
        this.logger.warn('UpdateFrequencyScorer', `lastUpdatedAt 不是有效日期: "${rawLastUpdated}"`);
      }
    }

    let baseScore = UPDATE_FREQUENCY_SCORES[frequency] ?? 0;
    let score = baseScore;

    if (!isSpecified) {
      score = 0;
    } else if (hasInvalidLastUpdated) {
      score = Math.max(0, baseScore - 30);
    } else if (hasLastUpdated && daysSinceLastUpdate !== undefined) {
      const expectedDays = this.getExpectedDays(frequency);
      if (expectedDays > 0 && daysSinceLastUpdate > expectedDays * 2) {
        const penalty = Math.min(30, Math.floor((daysSinceLastUpdate - expectedDays) / Math.max(1, expectedDays)) * 5);
        score = Math.max(0, score - penalty);
        this.logger.warn('UpdateFrequencyScorer', `数据超过预期更新时间，惩罚分数: -${penalty}`);
      }
    } else if (!hasLastUpdated && isSpecified) {
      score = Math.max(0, score - 10);
    }

    score = clampScore(score);

    this.logger.debug('UpdateFrequencyScorer', '更新频率评分详情', {
      frequency,
      isSpecified,
      hasLastUpdated,
      hasInvalidLastUpdated,
      rawLastUpdated,
      daysSinceLastUpdate,
      baseScore,
      finalScore: score,
    });

    if (!isSpecified) {
      risks.push({
        id: 'update-frequency-unspecified',
        category: 'update_frequency',
        level: 'high',
        message: '未指定数据更新频率',
        suggestion: '请在数据描述中明确指定数据的更新频率，可选值: realtime, hourly, daily, weekly, monthly, quarterly, yearly',
        evidence: [
          {
            type: 'value',
            description: '当前更新频率设置',
            value: '未指定 (unknown)',
            expected: '必须指定更新频率',
          },
        ],
      });
    }

    if (hasInvalidLastUpdated && rawLastUpdated) {
      risks.push({
        id: 'update-invalid-date',
        category: 'update_frequency',
        level: 'medium',
        message: `lastUpdatedAt 字段值无效，无法解析为日期: "${rawLastUpdated}"`,
        suggestion: '请修正 lastUpdatedAt 为有效的 ISO 8601 日期格式，例如: 2025-01-10T08:00:00Z 或 2025-01-10',
        evidence: [
          {
            type: 'date_check',
            description: '日期解析校验结果',
            value: `原始值: "${rawLastUpdated}" — 解析失败`,
            expected: '有效的 ISO 8601 日期字符串',
          },
        ],
      });
    }

    if (isSpecified && !hasLastUpdated && !hasInvalidLastUpdated) {
      risks.push({
        id: 'update-no-last-updated',
        category: 'update_frequency',
        level: 'low',
        message: '未提供最近一次更新时间',
        suggestion: '建议补充 lastUpdatedAt 字段，标明数据最近一次更新的时间',
        evidence: [
          {
            type: 'value',
            description: '最近更新时间',
            value: '未提供',
            expected: '建议提供 lastUpdatedAt',
          },
        ],
      });
    }

    if (daysSinceLastUpdate !== undefined && frequency !== 'unknown') {
      const expectedDays = this.getExpectedDays(frequency);
      if (expectedDays > 0 && daysSinceLastUpdate > expectedDays * 2) {
        risks.push({
          id: 'update-stale-data',
          category: 'update_frequency',
          level: daysSinceLastUpdate > expectedDays * 4 ? 'high' : 'medium',
          message: `数据可能已过期，最近更新时间为 ${daysSinceLastUpdate} 天前，而更新频率为 ${frequency}`,
          suggestion: '请按照设定的更新频率及时更新数据，确保数据时效性',
          evidence: [
            {
              type: 'date_check',
              description: '数据时效性检查',
              value: `距上次更新 ${daysSinceLastUpdate} 天`,
              expected: `按 ${frequency} 频率应 ${expectedDays} 天内更新，超时 ${daysSinceLastUpdate - expectedDays} 天`,
            },
          ],
        });
      }
    }

    const result: UpdateFrequencyResult = {
      score,
      maxScore: 100,
      currentFrequency: frequency,
      isSpecified,
      hasLastUpdated,
      hasInvalidLastUpdated,
      daysSinceLastUpdate,
      lastUpdatedRawValue: rawLastUpdated,
    };

    this.logger.info('UpdateFrequencyScorer', `更新频率评估完成，得分: ${score}/100`);

    return { result, risks };
  }

  private getExpectedDays(frequency: UpdateFrequencyType): number {
    const map: Record<UpdateFrequencyType, number> = {
      realtime: 1,
      hourly: 1,
      daily: 1,
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      yearly: 365,
      unknown: 0,
    };
    return map[frequency] ?? 0;
  }
}
