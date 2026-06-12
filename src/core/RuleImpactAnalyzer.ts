import {
  ScoringResult,
  ScoringInput,
  ScoringWeights,
  QualityGrade,
  RuleImpactAnalysisResult,
  RuleImpactAnalysisOptions,
  HighFrequencyRisk,
  RiskLevel,
  IndustryType,
} from '../types';
import { DIMENSION_NAMES, LOW_SCORE_THRESHOLD, GRADE_THRESHOLDS, safePercentage } from '../config';
import { ScoringEngine } from './ScoringEngine';
import { IndustryRuleRegistry } from './IndustryRuleRegistry';

export class RuleImpactAnalyzer {
  private engine: ScoringEngine;
  private ruleRegistry: IndustryRuleRegistry;

  constructor(engine: ScoringEngine) {
    this.engine = engine;
    this.ruleRegistry = IndustryRuleRegistry.getInstance();
  }

  analyzeBatchImpact(
    inputs: ScoringInput[],
    targetVersion: string,
    options?: RuleImpactAnalysisOptions
  ): RuleImpactAnalysisResult {
    if (inputs.length === 0) {
      throw new Error('评分输入不能为空');
    }

    const industry = (options?.industry || inputs[0].industry || 'general') as IndustryType;
    const baselineVersion = options?.baselineVersion;

    const baselineResults: ScoringResult[] = [];
    const targetResults: ScoringResult[] = [];

    for (const input of inputs) {
      const baselineInput: ScoringInput = {
        ...input,
        industry: input.industry || industry,
        industryConfigVersion: baselineVersion,
      };
      const targetInput: ScoringInput = {
        ...input,
        industry: input.industry || industry,
        industryConfigVersion: targetVersion,
      };

      baselineResults.push(this.engine.score(baselineInput));
      targetResults.push(this.engine.score(targetInput));
    }

    return this.compareResults(
      baselineResults,
      targetResults,
      {
        industry,
        baselineVersion: baselineVersion || baselineResults[0].metadata.industryConfigVersion || 'default',
        targetVersion,
      }
    );
  }

  compareResults(
    baselineResults: ScoringResult[],
    targetResults: ScoringResult[],
    options: {
      industry: IndustryType;
      baselineVersion: string;
      targetVersion: string;
    }
  ): RuleImpactAnalysisResult {
    if (baselineResults.length !== targetResults.length) {
      throw new Error('基准结果和目标结果数量不一致');
    }
    if (baselineResults.length === 0) {
      throw new Error('评分结果不能为空');
    }

    const { industry, baselineVersion, targetVersion } = options;
    const gradeOrder: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];

    const gradeDistributionBaseline: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    const gradeDistributionTarget: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };

    let improved = 0;
    let declined = 0;
    let unchanged = 0;
    const improvedProducts: string[] = [];
    const declinedProducts: string[] = [];

    let totalScoreChange = 0;
    let maxIncrease = 0;
    let maxDecrease = 0;

    for (let i = 0; i < baselineResults.length; i++) {
      const base = baselineResults[i];
      const target = targetResults[i];

      gradeDistributionBaseline[base.grade]++;
      gradeDistributionTarget[target.grade]++;

      const baseScore = safePercentage(base.totalScore, base.maxScore);
      const targetScore = safePercentage(target.totalScore, target.maxScore);
      const diff = targetScore - baseScore;

      totalScoreChange += diff;
      if (diff > maxIncrease) maxIncrease = diff;
      if (diff < maxDecrease) maxDecrease = diff;

      const baseGradeIndex = gradeOrder.indexOf(base.grade);
      const targetGradeIndex = gradeOrder.indexOf(target.grade);

      if (targetGradeIndex < baseGradeIndex) {
        improved++;
        improvedProducts.push(base.productId);
      } else if (targetGradeIndex > baseGradeIndex) {
        declined++;
        declinedProducts.push(base.productId);
      } else {
        unchanged++;
      }
    }

    const newRisks = this.analyzeNewRisks(baselineResults, targetResults);
    const resolvedRisks = this.analyzeResolvedRisks(baselineResults, targetResults);
    const increasedRisks = this.analyzeIncreasedRisks(baselineResults, targetResults);
    const dimensionImpact = this.analyzeDimensionImpact(baselineResults, targetResults);
    const riskCategoryImpact = this.analyzeRiskCategoryImpact(baselineResults, targetResults);
    const recommendations = this.generateRecommendations(
      declined,
      newRisks,
      dimensionImpact,
      targetVersion
    );

    return {
      analysisId: `impact-${Date.now()}`,
      industry,
      baselineVersion,
      targetVersion,
      analyzedAt: new Date().toISOString(),
      totalProducts: baselineResults.length,
      gradeDistribution: {
        baseline: gradeDistributionBaseline,
        target: gradeDistributionTarget,
      },
      gradeChanges: {
        improved,
        declined,
        unchanged,
        improvedProducts,
        declinedProducts,
      },
      scoreChanges: {
        averageScoreChange: Math.round((totalScoreChange / baselineResults.length) * 100) / 100,
        maxScoreIncrease: Math.round(maxIncrease * 100) / 100,
        maxScoreDecrease: Math.round(maxDecrease * 100) / 100,
      },
      newRisks,
      resolvedRisks,
      increasedRisks,
      dimensionImpact,
      riskCategoryImpact,
      recommendations,
    };
  }

  private analyzeNewRisks(
    baseline: ScoringResult[],
    target: ScoringResult[]
  ): HighFrequencyRisk[] {
    const riskMap = new Map<string, { risk: any; count: number; products: string[] }>();

    for (let i = 0; i < baseline.length; i++) {
      const baseRisks = new Set(baseline[i].risks.map((r) => r.id));
      for (const r of target[i].risks) {
        if (!baseRisks.has(r.id)) {
          const existing = riskMap.get(r.id);
          if (existing) {
            existing.count++;
            if (!existing.products.includes(target[i].productId)) {
              existing.products.push(target[i].productId);
            }
          } else {
            riskMap.set(r.id, {
              risk: r,
              count: 1,
              products: [target[i].productId],
            });
          }
        }
      }
    }

    const total = baseline.length;
    return Array.from(riskMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        id: item.risk.id,
        message: item.risk.message,
        level: item.risk.level,
        category: item.risk.category,
        occurrenceCount: item.count,
        occurrencePercentage: total > 0 ? Math.round((item.count / total) * 10000) / 100 : 0,
        affectedProducts: item.products,
      }));
  }

  private analyzeResolvedRisks(
    baseline: ScoringResult[],
    target: ScoringResult[]
  ): HighFrequencyRisk[] {
    const riskMap = new Map<string, { risk: any; count: number; products: string[] }>();

    for (let i = 0; i < baseline.length; i++) {
      const targetRisks = new Set(target[i].risks.map((r) => r.id));
      for (const r of baseline[i].risks) {
        if (!targetRisks.has(r.id)) {
          const existing = riskMap.get(r.id);
          if (existing) {
            existing.count++;
            if (!existing.products.includes(baseline[i].productId)) {
              existing.products.push(baseline[i].productId);
            }
          } else {
            riskMap.set(r.id, {
              risk: r,
              count: 1,
              products: [baseline[i].productId],
            });
          }
        }
      }
    }

    const total = baseline.length;
    return Array.from(riskMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        id: item.risk.id,
        message: item.risk.message,
        level: item.risk.level,
        category: item.risk.category,
        occurrenceCount: item.count,
        occurrencePercentage: total > 0 ? Math.round((item.count / total) * 10000) / 100 : 0,
        affectedProducts: item.products,
      }));
  }

  private analyzeIncreasedRisks(
    baseline: ScoringResult[],
    target: ScoringResult[]
  ): HighFrequencyRisk[] {
    const levelOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const riskMap = new Map<string, { risk: any; count: number; products: string[] }>();

    for (let i = 0; i < baseline.length; i++) {
      const baseRiskMap = new Map(baseline[i].risks.map((r) => [r.id, r]));
      for (const r of target[i].risks) {
        const baseRisk = baseRiskMap.get(r.id);
        if (baseRisk && levelOrder[r.level] < levelOrder[baseRisk.level]) {
          const existing = riskMap.get(r.id);
          if (existing) {
            existing.count++;
            if (!existing.products.includes(target[i].productId)) {
              existing.products.push(target[i].productId);
            }
          } else {
            riskMap.set(r.id, {
              risk: r,
              count: 1,
              products: [target[i].productId],
            });
          }
        }
      }
    }

    const total = baseline.length;
    return Array.from(riskMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        id: item.risk.id,
        message: item.risk.message,
        level: item.risk.level,
        category: item.risk.category,
        occurrenceCount: item.count,
        occurrencePercentage: total > 0 ? Math.round((item.count / total) * 10000) / 100 : 0,
        affectedProducts: item.products,
      }));
  }

  private analyzeDimensionImpact(
    baseline: ScoringResult[],
    target: ScoringResult[]
  ): RuleImpactAnalysisResult['dimensionImpact'] {
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
      let totalDiff = 0;
      let worsened = 0;
      let improved = 0;

      for (let i = 0; i < baseline.length; i++) {
        const baseDim = baseline[i].dimensionScores[resultKeys[key]];
        const targetDim = target[i].dimensionScores[resultKeys[key]];
        const baseScore = safePercentage(baseDim.score, baseDim.maxScore);
        const targetScore = safePercentage(targetDim.score, targetDim.maxScore);
        const diff = targetScore - baseScore;
        totalDiff += diff;

        if (diff < -0.01) worsened++;
        if (diff > 0.01) improved++;
      }

      return {
        dimensionKey: key,
        dimensionName: DIMENSION_NAMES[key],
        averageScoreChange: Math.round((totalDiff / baseline.length) * 100) / 100,
        productsWorsened: worsened,
        productsImproved: improved,
      };
    });
  }

  private analyzeRiskCategoryImpact(
    baseline: ScoringResult[],
    target: ScoringResult[]
  ): RuleImpactAnalysisResult['riskCategoryImpact'] {
    const baseCatCount = new Map<string, number>();
    const targetCatCount = new Map<string, number>();

    for (const r of baseline) {
      const cats = new Set(r.risks.map((risk) => risk.category));
      for (const cat of cats) {
        baseCatCount.set(cat, (baseCatCount.get(cat) || 0) + 1);
      }
    }

    for (const r of target) {
      const cats = new Set(r.risks.map((risk) => risk.category));
      for (const cat of cats) {
        targetCatCount.set(cat, (targetCatCount.get(cat) || 0) + 1);
      }
    }

    const allCategories = new Set([...baseCatCount.keys(), ...targetCatCount.keys()]);

    return Array.from(allCategories).map((cat) => {
      const base = baseCatCount.get(cat) || 0;
      const tgt = targetCatCount.get(cat) || 0;
      return {
        category: cat,
        baselineCount: base,
        targetCount: tgt,
        change: tgt - base,
      };
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  private generateRecommendations(
    declinedCount: number,
    newRisks: HighFrequencyRisk[],
    dimensionImpact: RuleImpactAnalysisResult['dimensionImpact'],
    targetVersion: string
  ): string[] {
    const recommendations: string[] = [];

    if (declinedCount === 0) {
      recommendations.push('本次规则变更无产品等级下降，可安全发布');
    } else if (declinedCount > 0) {
      recommendations.push(
        `本次规则变更预计有 ${declinedCount} 个产品等级下降，建议发布前与相关业务方沟通`
      );
    }

    if (newRisks.length > 0) {
      const criticalNew = newRisks.filter((r) => r.level === 'critical' || r.level === 'high');
      if (criticalNew.length > 0) {
        recommendations.push(`新增 ${criticalNew.length} 项高优先级风险，请评估影响范围`);
      }
    }

    const worsenedDims = dimensionImpact.filter((d) => d.productsWorsened > 0);
    if (worsenedDims.length > 0) {
      const worstDim = worsenedDims.sort((a, b) => b.productsWorsened - a.productsWorsened)[0];
      recommendations.push(
        `${worstDim.dimensionName}维度受影响最大，${worstDim.productsWorsened} 个产品得分下降`
      );
    }

    recommendations.push(`建议在 ${targetVersion} 版本发布前进行小范围灰度验证`);
    recommendations.push('发布后监控首周数据质量评分变化，准备回滚预案');

    return recommendations;
  }
}
