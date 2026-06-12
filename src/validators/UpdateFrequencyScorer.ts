import {
  UpdateFrequencyResult,
  DataProductDescription,
  UpdateFrequencyType,
  RiskItem,
} from '../types';
import { UPDATE_FREQUENCY_SCORES } from '../config';
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
    const hasLastUpdated = !!description?.lastUpdatedAt;

    let daysSinceLastUpdate: number | undefined;
    if (hasLastUpdated && description?.lastUpdatedAt) {
      try {
        const lastUpdate = new Date(description.lastUpdatedAt);
        const now = new Date();
        daysSinceLastUpdate = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
      } catch {
        this.logger.warn('UpdateFrequencyScorer', `无法解析 lastUpdatedAt: ${description.lastUpdatedAt}`);
      }
    }

    let score = UPDATE_FREQUENCY_SCORES[frequency] ?? 0;

    if (!isSpecified) {
      score = 0;
    } else if (hasLastUpdated && daysSinceLastUpdate !== undefined) {
      const expectedDays = this.getExpectedDays(frequency);
      if (expectedDays > 0 && daysSinceLastUpdate > expectedDays * 2) {
        const penalty = Math.min(30, Math.floor((daysSinceLastUpdate - expectedDays) / expectedDays) * 5);
        score = Math.max(0, score - penalty);
        this.logger.warn('UpdateFrequencyScorer', `数据超过预期更新时间，惩罚分数: -${penalty}`);
      }
    } else if (!hasLastUpdated && isSpecified) {
      score = Math.max(0, score - 10);
    }

    score = Math.round(score);

    this.logger.debug('UpdateFrequencyScorer', '更新频率评分详情', {
      frequency,
      isSpecified,
      hasLastUpdated,
      daysSinceLastUpdate,
      finalScore: score,
    });

    if (!isSpecified) {
      risks.push({
        id: 'update-frequency-unspecified',
        category: 'update_frequency',
        level: 'high',
        message: '未指定数据更新频率',
        suggestion: '请在数据描述中明确指定数据的更新频率，可选值: realtime, hourly, daily, weekly, monthly, quarterly, yearly',
      });
    }

    if (isSpecified && !hasLastUpdated) {
      risks.push({
        id: 'update-no-last-updated',
        category: 'update_frequency',
        level: 'low',
        message: '未提供最近一次更新时间',
        suggestion: '建议补充 lastUpdatedAt 字段，标明数据最近一次更新的时间',
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
        });
      }
    }

    const result: UpdateFrequencyResult = {
      score,
      maxScore: 100,
      currentFrequency: frequency,
      isSpecified,
      hasLastUpdated,
      daysSinceLastUpdate,
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
