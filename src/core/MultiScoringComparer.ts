import {
  ScoringResult,
  ScoringWeights,
  MultiScoringComparisonResult,
  MultiComparisonOptions,
  LowScoringDimension,
  RiskItem,
  QualityGrade,
} from '../types';
import { DIMENSION_NAMES, LOW_SCORE_THRESHOLD, safePercentage } from '../config';

export class MultiScoringComparer {
  static compare(
    results: ScoringResult[],
    options?: MultiComparisonOptions
  ): MultiScoringComparisonResult {
    if (results.length < 2) {
      throw new Error('多方案对比至少需要 2 个评分结果');
    }

    const productId = results[0].productId;
    for (const r of results) {
      if (r.productId !== productId) {
        throw new Error(`只能对比同一产品的评分结果，发现不一致: ${productId} vs ${r.productId}`);
      }
    }

    const labels = options?.labels || results.map((_, i) => `方案${String.fromCharCode(65 + i)}`);
    const lowScoreThreshold = options?.lowScoreThreshold ?? LOW_SCORE_THRESHOLD;
    const criteria = options?.bestScoreCriteria || 'highestScore';

    const scenarios = results.map((result, index) => {
      const scorePercent = safePercentage(result.totalScore, result.maxScore);
      return {
        label: labels[index] || `方案${index + 1}`,
        result,
        totalScorePercent: Math.round(scorePercent * 100) / 100,
        grade: result.grade,
      };
    });

    const ranked = this.rankScenarios(scenarios, criteria);

    const dimensionComparison = this.buildDimensionComparison(scenarios, lowScoreThreshold);
    const riskComparison = this.buildRiskComparison(scenarios);
    const lowScoringDimensionsComparison = this.buildLowScoringDimensionsComparison(
      scenarios,
      lowScoreThreshold
    );

    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    return {
      productId,
      scenarios: ranked,
      bestScenario: {
        label: best.label,
        totalScorePercent: best.totalScorePercent,
        grade: best.grade,
        reason: this.getBestReason(criteria, best, worst),
      },
      worstScenario: {
        label: worst.label,
        totalScorePercent: worst.totalScorePercent,
        grade: worst.grade,
        reason: `综合表现最差，总分 ${worst.totalScorePercent}%，等级 ${worst.grade}`,
      },
      dimensionComparison,
      riskComparison,
      lowScoringDimensionsComparison,
      scoredAt: new Date().toISOString(),
    };
  }

  private static rankScenarios(
    scenarios: Array<{
      label: string;
      result: ScoringResult;
      totalScorePercent: number;
      grade: QualityGrade;
    }>,
    criteria: string
  ): MultiScoringComparisonResult['scenarios'] {
    const gradeOrder: Record<QualityGrade, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

    const sorted = [...scenarios].sort((a, b) => {
      switch (criteria) {
        case 'highestScore':
          return b.totalScorePercent - a.totalScorePercent;
        case 'leastRisks':
          return a.result.risks.length - b.result.risks.length;
        case 'bestGrade':
          return gradeOrder[a.grade] - gradeOrder[b.grade];
        case 'leastLowDimensions': {
          const lowA = this.countLowDimensions(a.result);
          const lowB = this.countLowDimensions(b.result);
          return lowA - lowB;
        }
        default:
          return b.totalScorePercent - a.totalScorePercent;
      }
    });

    return sorted.map((s, index) => ({ ...s, rank: index + 1 }));
  }

  private static countLowDimensions(result: ScoringResult): number {
    const dimKeys: Array<keyof ScoringWeights> = [
      'fieldCompleteness',
      'sampleCompleteness',
      'sensitiveField',
      'updateFrequency',
      'descriptionCompleteness',
      'authorization',
    ];
    const resultKeys: Record<keyof ScoringWeights, keyof ScoringResult['dimensionScores']> = {
      fieldCompleteness: 'fieldCompleteness',
      sampleCompleteness: 'sampleCompleteness',
      sensitiveField: 'sensitiveField',
      updateFrequency: 'updateFrequency',
      descriptionCompleteness: 'descriptionCompleteness',
      authorization: 'authorization',
    };

    let count = 0;
    for (const key of dimKeys) {
      const dim = result.dimensionScores[resultKeys[key]];
      const score = safePercentage(dim.score, dim.maxScore);
      if (score < LOW_SCORE_THRESHOLD) count++;
    }
    return count;
  }

  private static getBestReason(
    criteria: string,
    best: { label: string; totalScorePercent: number; grade: QualityGrade; result: ScoringResult },
    worst: { label: string; totalScorePercent: number }
  ): string {
    const diff = Math.round((best.totalScorePercent - worst.totalScorePercent) * 100) / 100;
    switch (criteria) {
      case 'highestScore':
        return `总分最高，达 ${best.totalScorePercent}%，较最低方案高 ${diff} 个百分点`;
      case 'leastRisks':
        return `风险项最少，共 ${best.result.risks.length} 项，等级 ${best.grade}`;
      case 'bestGrade':
        return `质量等级最高，为 ${best.grade} 级`;
      case 'leastLowDimensions':
        return `低分维度最少，综合表现均衡，等级 ${best.grade}`;
      default:
        return `综合表现最优，总分 ${best.totalScorePercent}%，等级 ${best.grade}`;
    }
  }

  private static buildDimensionComparison(
    scenarios: Array<{ label: string; result: ScoringResult; totalScorePercent: number }>,
    lowScoreThreshold: number
  ): MultiScoringComparisonResult['dimensionComparison'] {
    const dimKeys: Array<keyof ScoringWeights> = [
      'fieldCompleteness',
      'sampleCompleteness',
      'sensitiveField',
      'updateFrequency',
      'descriptionCompleteness',
      'authorization',
    ];
    const resultKeys: Record<keyof ScoringWeights, keyof ScoringResult['dimensionScores']> = {
      fieldCompleteness: 'fieldCompleteness',
      sampleCompleteness: 'sampleCompleteness',
      sensitiveField: 'sensitiveField',
      updateFrequency: 'updateFrequency',
      descriptionCompleteness: 'descriptionCompleteness',
      authorization: 'authorization',
    };

    return dimKeys.map((key) => {
      const scores: Record<string, number> = {};
      let maxScore = -Infinity;
      let minScore = Infinity;
      let bestLabel = '';
      let worstLabel = '';

      for (const s of scenarios) {
        const dim = s.result.dimensionScores[resultKeys[key]];
        const score = Math.round(safePercentage(dim.score, dim.maxScore) * 100) / 100;
        scores[s.label] = score;
        if (score > maxScore) {
          maxScore = score;
          bestLabel = s.label;
        }
        if (score < minScore) {
          minScore = score;
          worstLabel = s.label;
        }
      }

      return {
        dimensionKey: key,
        dimensionName: DIMENSION_NAMES[key],
        scores,
        bestLabel,
        worstLabel,
        maxDiff: Math.round((maxScore - minScore) * 100) / 100,
      };
    });
  }

  private static buildRiskComparison(
    scenarios: Array<{ label: string; result: ScoringResult; totalScorePercent: number }>
  ): MultiScoringComparisonResult['riskComparison'] {
    const totalRiskCounts: Record<string, number> = {};
    const criticalRiskCounts: Record<string, number> = {};
    const newRisksPerScenario: Record<string, RiskItem[]> = {};
    const resolvedRisksPerScenario: Record<string, RiskItem[]> = {};

    const allRiskIds = new Set<string>();
    for (const s of scenarios) {
      for (const r of s.result.risks) {
        allRiskIds.add(r.id);
      }
    }

    let baselineRisks = new Set(scenarios[0].result.risks.map((r) => r.id));

    for (const s of scenarios) {
      totalRiskCounts[s.label] = s.result.risks.length;
      criticalRiskCounts[s.label] = s.result.risks.filter(
        (r) => r.level === 'critical' || r.level === 'high'
      ).length;

      const currentRiskIds = new Set(s.result.risks.map((r) => r.id));
      const newRisks: RiskItem[] = [];
      const resolvedRisks: RiskItem[] = [];

      for (const r of s.result.risks) {
        if (!baselineRisks.has(r.id)) {
          newRisks.push(r);
        }
      }

      for (const baselineId of baselineRisks) {
        if (!currentRiskIds.has(baselineId)) {
          const baselineRisk = scenarios[0].result.risks.find((r) => r.id === baselineId);
          if (baselineRisk) resolvedRisks.push(baselineRisk);
        }
      }

      newRisksPerScenario[s.label] = newRisks;
      resolvedRisksPerScenario[s.label] = resolvedRisks;
    }

    return {
      totalRiskCounts,
      criticalRiskCounts,
      newRisksPerScenario,
      resolvedRisksPerScenario,
    };
  }

  private static buildLowScoringDimensionsComparison(
    scenarios: Array<{ label: string; result: ScoringResult; totalScorePercent: number }>,
    lowScoreThreshold: number
  ): Record<string, LowScoringDimension[]> {
    const result: Record<string, LowScoringDimension[]> = {};
    const dimKeys: Array<keyof ScoringWeights> = [
      'fieldCompleteness',
      'sampleCompleteness',
      'sensitiveField',
      'updateFrequency',
      'descriptionCompleteness',
      'authorization',
    ];
    const resultKeys: Record<keyof ScoringWeights, keyof ScoringResult['dimensionScores']> = {
      fieldCompleteness: 'fieldCompleteness',
      sampleCompleteness: 'sampleCompleteness',
      sensitiveField: 'sensitiveField',
      updateFrequency: 'updateFrequency',
      descriptionCompleteness: 'descriptionCompleteness',
      authorization: 'authorization',
    };

    for (const s of scenarios) {
      const lowDims: LowScoringDimension[] = [];
      for (const key of dimKeys) {
        const dim = s.result.dimensionScores[resultKeys[key]];
        const score = safePercentage(dim.score, dim.maxScore);
        if (score < lowScoreThreshold) {
          lowDims.push({
            dimension: DIMENSION_NAMES[key],
            dimensionKey: key,
            averageScore: Math.round(score * 100) / 100,
            belowThresholdCount: 1,
            affectedProducts: [s.result.productId],
          });
        }
      }
      result[s.label] = lowDims.sort((a, b) => a.averageScore - b.averageScore);
    }

    return result;
  }
}
