import {
  ScoringResult,
  ScoringWeights,
  ScoringComparisonResult,
  ScoreComparisonDelta,
  RiskComparisonDelta,
  ComparisonOptions,
  LowScoringDimension,
  RiskLevel,
} from '../types';
import { DIMENSION_NAMES, LOW_SCORE_THRESHOLD, safePercentage } from '../config';

export class ScoringResultComparer {
  static compare(
    resultA: ScoringResult,
    resultB: ScoringResult,
    options?: ComparisonOptions
  ): ScoringComparisonResult {
    if (resultA.productId !== resultB.productId) {
      throw new Error(
        `只能对比同一产品的评分结果，A: ${resultA.productId}, B: ${resultB.productId}`
      );
    }

    const labelA = options?.labelA || '方案A';
    const labelB = options?.labelB || '方案B';
    const lowScoreThreshold = options?.lowScoreThreshold ?? LOW_SCORE_THRESHOLD;

    const totalScoreA = safePercentage(resultA.totalScore, resultA.maxScore);
    const totalScoreB = safePercentage(resultB.totalScore, resultB.maxScore);
    const totalScoreDiff = Math.round((totalScoreB - totalScoreA) * 100) / 100;

    const dimensionDeltas = this.buildDimensionDeltas(resultA, resultB);
    const riskDeltas = this.buildRiskDeltas(resultA, resultB);
    const lowScoringDimensionsA = this.extractLowScoringDimensions(
      resultA,
      lowScoreThreshold
    );
    const lowScoringDimensionsB = this.extractLowScoringDimensions(
      resultB,
      lowScoreThreshold
    );

    return {
      productId: resultA.productId,
      labelA,
      labelB,
      totalScoreA: Math.round(totalScoreA * 100) / 100,
      totalScoreB: Math.round(totalScoreB * 100) / 100,
      totalScoreDiff,
      gradeA: resultA.grade,
      gradeB: resultB.grade,
      gradeChanged: resultA.grade !== resultB.grade,
      dimensionDeltas,
      improvedDimensions: dimensionDeltas.filter((d) => d.scoreDiff > 0),
      worsenedDimensions: dimensionDeltas.filter((d) => d.scoreDiff < 0),
      unchangedDimensions: dimensionDeltas.filter((d) => d.scoreDiff === 0),
      riskDeltas,
      newRisks: riskDeltas.filter((r) => !r.inA && r.inB),
      resolvedRisks: riskDeltas.filter((r) => r.inA && !r.inB),
      levelIncreasedRisks: riskDeltas.filter((r) => r.levelChange === 'up'),
      levelDecreasedRisks: riskDeltas.filter((r) => r.levelChange === 'down'),
      lowScoringDimensionsA,
      lowScoringDimensionsB,
      weightsA: resultA.metadata.weights,
      weightsB: resultB.metadata.weights,
      ruleInfoA: {
        industry: resultA.metadata.industry,
        version: resultA.metadata.industryConfigVersion || 'default',
        description: resultA.metadata.industryConfigDescription || '默认规则',
      },
      ruleInfoB: {
        industry: resultB.metadata.industry,
        version: resultB.metadata.industryConfigVersion || 'default',
        description: resultB.metadata.industryConfigDescription || '默认规则',
      },
      scoredAt: new Date().toISOString(),
    };
  }

  private static buildDimensionDeltas(
    resultA: ScoringResult,
    resultB: ScoringResult
  ): ScoreComparisonDelta[] {
    const dimensionKeys: Array<keyof ScoringWeights> = [
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

    return dimensionKeys.map((key) => {
      const dimA = resultA.dimensionScores[resultKeys[key]];
      const dimB = resultB.dimensionScores[resultKeys[key]];
      const scoreA = safePercentage(dimA.score, dimA.maxScore);
      const scoreB = safePercentage(dimB.score, dimB.maxScore);

      return {
        dimension: DIMENSION_NAMES[key],
        dimensionKey: key,
        scoreA: Math.round(scoreA * 100) / 100,
        scoreB: Math.round(scoreB * 100) / 100,
        scoreDiff: Math.round((scoreB - scoreA) * 100) / 100,
        maxScore: 100,
      };
    });
  }

  private static buildRiskDeltas(
    resultA: ScoringResult,
    resultB: ScoringResult
  ): RiskComparisonDelta[] {
    const riskMap = new Map<string, RiskComparisonDelta>();

    const levelOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    for (const risk of resultA.risks) {
      riskMap.set(risk.id, {
        riskId: risk.id,
        category: risk.category,
        message: risk.message,
        inA: true,
        inB: false,
        levelA: risk.level,
      });
    }

    for (const risk of resultB.risks) {
      const existing = riskMap.get(risk.id);
      if (existing) {
        existing.inB = true;
        existing.levelB = risk.level;
        if (existing.levelA && existing.levelB) {
          const orderA = levelOrder[existing.levelA];
          const orderB = levelOrder[existing.levelB];
          if (orderB < orderA) {
            existing.levelChange = 'up';
          } else if (orderB > orderA) {
            existing.levelChange = 'down';
          } else {
            existing.levelChange = 'same';
          }
        }
      } else {
        riskMap.set(risk.id, {
          riskId: risk.id,
          category: risk.category,
          message: risk.message,
          inA: false,
          inB: true,
          levelB: risk.level,
        });
      }
    }

    return Array.from(riskMap.values()).sort((a, b) => {
      const levelVal = (r: RiskComparisonDelta) => {
        const l = r.levelB || r.levelA || 'low';
        return levelOrder[l];
      };
      return levelVal(a) - levelVal(b);
    });
  }

  private static extractLowScoringDimensions(
    result: ScoringResult,
    threshold: number
  ): LowScoringDimension[] {
    const dimensionKeys: Array<keyof ScoringWeights> = [
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

    const lowDimensions: LowScoringDimension[] = [];

    for (const key of dimensionKeys) {
      const dim = result.dimensionScores[resultKeys[key]];
      const score = safePercentage(dim.score, dim.maxScore);
      if (score < threshold) {
        lowDimensions.push({
          dimension: DIMENSION_NAMES[key],
          dimensionKey: key,
          averageScore: Math.round(score * 100) / 100,
          belowThresholdCount: 1,
          affectedProducts: [result.productId],
        });
      }
    }

    return lowDimensions.sort((a, b) => a.averageScore - b.averageScore);
  }
}
