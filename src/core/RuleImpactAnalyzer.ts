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
  ProductImpactDetail,
  ReleaseRiskItem,
  GroupedImpactSummary,
  RiskItem,
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

    const productDetails: ProductImpactDetail[] = [];
    const releaseRiskList: ReleaseRiskItem[] = [];

    const byIndustryData: Record<string, { total: number; declined: number; newRisks: number; scoreChanges: number[] }> = {};
    const byRiskCategoryData: Record<string, { productIds: Set<string>; totalOccurrences: number; highPriorityCount: number }> = {};
    const byGradeDeclineData: Record<string, { count: number; products: string[]; scoreDrops: number[] }> = {};

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

      let gradeChange: 'improved' | 'declined' | 'unchanged' = 'unchanged';
      if (targetGradeIndex < baseGradeIndex) {
        improved++;
        improvedProducts.push(base.productId);
        gradeChange = 'improved';
      } else if (targetGradeIndex > baseGradeIndex) {
        declined++;
        declinedProducts.push(base.productId);
        gradeChange = 'declined';
      } else {
        unchanged++;
      }

      const baseRisks = new Map(base.risks.map((r) => [r.id, r]));
      const targetRisks = new Map(target.risks.map((r) => [r.id, r]));

      const newRisks: RiskItem[] = [];
      const resolvedRisks: RiskItem[] = [];
      const increasedRisks: RiskItem[] = [];
      const levelOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

      for (const r of target.risks) {
        if (!baseRisks.has(r.id)) {
          newRisks.push(r);
        } else {
          const baseRisk = baseRisks.get(r.id)!;
          if (levelOrder[r.level] < levelOrder[baseRisk.level]) {
            increasedRisks.push(r);
          }
        }
      }

      for (const r of base.risks) {
        if (!targetRisks.has(r.id)) {
          resolvedRisks.push(r);
        }
      }

      const dimensionChanges = dimKeys.map((key) => {
        const baseDim = base.dimensionScores[resultKeys[key]];
        const targetDim = target.dimensionScores[resultKeys[key]];
        const baseDimScore = safePercentage(baseDim.score, baseDim.maxScore);
        const targetDimScore = safePercentage(targetDim.score, targetDim.maxScore);
        return {
          dimensionKey: key,
          dimensionName: DIMENSION_NAMES[key],
          baselineScore: baseDimScore,
          targetScore: targetDimScore,
          scoreChange: Math.round((targetDimScore - baseDimScore) * 100) / 100,
        };
      });

      productDetails.push({
        productId: base.productId,
        baselineGrade: base.grade,
        targetGrade: target.grade,
        gradeChange,
        baselineScore: baseScore,
        targetScore: targetScore,
        scoreChange: Math.round(diff * 100) / 100,
        newRisks,
        resolvedRisks,
        increasedRisks,
        dimensionChanges,
      });

      if (gradeChange === 'declined') {
        const declineKey = `${base.grade}→${target.grade}`;
        if (!byGradeDeclineData[declineKey]) {
          byGradeDeclineData[declineKey] = { count: 0, products: [], scoreDrops: [] };
        }
        byGradeDeclineData[declineKey].count++;
        byGradeDeclineData[declineKey].products.push(base.productId);
        byGradeDeclineData[declineKey].scoreDrops.push(Math.abs(diff));

        releaseRiskList.push({
          riskId: `grade-decline-${base.productId}`,
          productId: base.productId,
          riskLevel: diff < -10 ? 'high' : 'medium',
          riskCategory: 'grade_decline',
          description: `等级从 ${base.grade} 下降到 ${target.grade}，分数下降 ${Math.abs(diff).toFixed(1)}%`,
          impactType: 'grade_decline',
          severity: diff < -15 ? 'critical' : diff < -10 ? 'high' : 'medium',
          recommendation: `建议检查该产品数据质量，修复缺失字段或补充数据说明，以符合新版本规则要求`,
        });
      }

      if (diff < -5) {
        releaseRiskList.push({
          riskId: `score-drop-${base.productId}`,
          productId: base.productId,
          riskLevel: diff < -15 ? 'critical' : diff < -10 ? 'high' : 'medium',
          riskCategory: 'score_drop',
          description: `综合评分下降 ${Math.abs(diff).toFixed(1)}%`,
          impactType: 'score_drop',
          severity: diff < -15 ? 'critical' : diff < -10 ? 'high' : 'medium',
          recommendation: `分析各维度得分变化，重点整改低分维度`,
        });
      }

      for (const r of newRisks) {
        releaseRiskList.push({
          riskId: `new-${r.id}-${base.productId}`,
          productId: base.productId,
          riskLevel: r.level,
          riskCategory: r.category,
          description: r.message,
          impactType: 'new_risk',
          severity: r.level === 'critical' ? 'critical' : r.level === 'high' ? 'high' : 'medium',
          recommendation: this.getRiskRecommendation(r),
        });

        if (!byRiskCategoryData[r.category]) {
          byRiskCategoryData[r.category] = { productIds: new Set(), totalOccurrences: 0, highPriorityCount: 0 };
        }
        byRiskCategoryData[r.category].productIds.add(base.productId);
        byRiskCategoryData[r.category].totalOccurrences++;
        if (r.level === 'critical' || r.level === 'high') {
          byRiskCategoryData[r.category].highPriorityCount++;
        }
      }

      for (const r of increasedRisks) {
        releaseRiskList.push({
          riskId: `increase-${r.id}-${base.productId}`,
          productId: base.productId,
          riskLevel: r.level,
          riskCategory: r.category,
          description: `风险级别提升：${r.message}`,
          impactType: 'risk_increase',
          severity: r.level === 'critical' ? 'critical' : r.level === 'high' ? 'high' : 'medium',
          recommendation: this.getRiskRecommendation(r),
        });
      }

      const productIndustry = base.metadata.industry || industry;
      if (!byIndustryData[productIndustry]) {
        byIndustryData[productIndustry] = { total: 0, declined: 0, newRisks: 0, scoreChanges: [] };
      }
      byIndustryData[productIndustry].total++;
      if (gradeChange === 'declined') byIndustryData[productIndustry].declined++;
      byIndustryData[productIndustry].newRisks += newRisks.length;
      byIndustryData[productIndustry].scoreChanges.push(diff);
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

    const byIndustry: GroupedImpactSummary['byIndustry'] = {};
    for (const [ind, data] of Object.entries(byIndustryData)) {
      const avgChange = data.scoreChanges.length > 0
        ? data.scoreChanges.reduce((s, c) => s + c, 0) / data.scoreChanges.length
        : 0;
      byIndustry[ind] = {
        total: data.total,
        declined: data.declined,
        newRisks: data.newRisks,
        averageScoreChange: Math.round(avgChange * 100) / 100,
      };
    }

    const byRiskCategory: GroupedImpactSummary['byRiskCategory'] = {};
    for (const [cat, data] of Object.entries(byRiskCategoryData)) {
      byRiskCategory[cat] = {
        totalProducts: data.productIds.size,
        totalOccurrences: data.totalOccurrences,
        highPriorityCount: data.highPriorityCount,
      };
    }

    const byGradeDecline: GroupedImpactSummary['byGradeDecline'] = {};
    for (const [key, data] of Object.entries(byGradeDeclineData)) {
      const avgDrop = data.scoreDrops.length > 0
        ? data.scoreDrops.reduce((s, c) => s + c, 0) / data.scoreDrops.length
        : 0;
      byGradeDecline[key] = {
        count: data.count,
        products: data.products,
        averageScoreDrop: Math.round(avgDrop * 100) / 100,
      };
    }

    releaseRiskList.sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

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
      productDetails,
      releaseRiskList,
      groupedSummary: {
        byIndustry,
        byRiskCategory,
        byGradeDecline,
      },
    };
  }

  private getRiskRecommendation(risk: RiskItem): string {
    switch (risk.category) {
      case 'field_completeness':
        return '补充缺失的必填字段，确保字段完整性达标';
      case 'sample_completeness':
        return '检查样本数据质量，修复缺失值和异常值';
      case 'sensitive_field':
        return '对敏感字段进行脱敏或加密处理，调整授权范围';
      case 'update_frequency':
        return '更新数据时间，确保数据新鲜度符合要求';
      case 'description_completeness':
        return '完善数据产品描述信息，补充缺失的必填字段';
      case 'authorization':
        return '检查授权范围配置，确保合规性';
      default:
        return '建议人工审核该风险项，评估是否需要整改';
    }
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
