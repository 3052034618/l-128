import {
  IndustryType,
  RuleStatus,
  RuleReviewView,
  RuleReviewItem,
  RuleReviewOptions,
  RuleStatusTransition,
  RegisteredIndustryConfig,
  ScoringInput,
  RuleImpactAnalysisResult,
} from '../types';
import { IndustryRuleRegistry } from './IndustryRuleRegistry';
import { RuleImpactAnalyzer } from './RuleImpactAnalyzer';
import { ScoringEngine } from './ScoringEngine';

export class RuleReviewService {
  private registry: IndustryRuleRegistry;
  private impactAnalyzer: RuleImpactAnalyzer | null = null;

  constructor(engine?: ScoringEngine) {
    this.registry = IndustryRuleRegistry.getInstance();
    if (engine) {
      this.impactAnalyzer = new RuleImpactAnalyzer(engine);
    }
  }

  generateReviewView(options?: RuleReviewOptions): RuleReviewView {
    const filterIndustries = options?.industries;
    const filterStatuses = options?.includeStatuses;
    const includeImpact = options?.includeImpactAnalysis ?? false;
    const impactInputs = options?.impactAnalysisInputs || [];
    const baselineVersion = options?.baselineVersion;

    const allIndustries = Array.from(this.registry.listIndustries()) as IndustryType[];
    const industries = filterIndustries && filterIndustries.length > 0
      ? allIndustries.filter((i) => filterIndustries.includes(i))
      : allIndustries;

    const rulesByIndustry: Record<IndustryType, RuleReviewItem[]> = {} as any;
    let draftCount = 0;
    let trialCount = 0;
    let publishedCount = 0;
    let deprecatedCount = 0;
    let pendingReviewCount = 0;
    let recommendApproveCount = 0;
    let recommendCautionCount = 0;
    let recommendBlockCount = 0;
    let totalRules = 0;

    for (const industry of industries) {
      const versions = this.registry.listVersions(industry);
      const items: RuleReviewItem[] = [];

      for (const version of versions) {
        const rule = this.registry.getRule(industry, version, {
          allowDraft: true,
          allowTrial: true,
          allowDeprecated: true,
        });

        if (!rule || !rule.config) continue;

        const config = rule.config as RegisteredIndustryConfig;

        if (filterStatuses && filterStatuses.length > 0 && !filterStatuses.includes(config.status)) {
          continue;
        }

        const statusHistory = this.registry.getStatusHistory(industry, version);
        const lastChange = statusHistory.length > 0
          ? statusHistory[statusHistory.length - 1]
          : {
              fromStatus: null,
              toStatus: config.status as RuleStatus,
              changedAt: config.registeredAt,
              remark: '规则创建',
            } as RuleStatusTransition;

        let impactSummary: RuleReviewItem['impactSummary'] | undefined;
        let publishRecommendation: RuleReviewItem['publishRecommendation'] = 'pending';
        let recommendationReason = '待分析，请运行影响预估后查看建议';

        if (includeImpact && impactInputs.length > 0 && this.impactAnalyzer) {
          if (config.status === 'trial' || config.status === 'draft') {
            try {
              const analysis = this.impactAnalyzer.analyzeBatchImpact(
                impactInputs,
                version,
                {
                  industry,
                  baselineVersion: baselineVersion,
                }
              );

              impactSummary = {
                analyzedProducts: analysis.totalProducts,
                gradeDeclines: analysis.gradeChanges.declined,
                newRisks: analysis.newRisks.length,
                averageScoreChange: analysis.scoreChanges.averageScoreChange,
                lastAnalyzedAt: new Date().toISOString(),
              };

              const recommendation = this.generatePublishRecommendation(config.status, analysis);
              publishRecommendation = recommendation.recommendation;
              recommendationReason = recommendation.reason;
            } catch (e: any) {
              recommendationReason = `影响分析失败：${e.message}`;
            }
          } else if (config.status === 'published') {
            publishRecommendation = 'approve';
            recommendationReason = '规则已正式发布';
          } else if (config.status === 'deprecated') {
            publishRecommendation = 'block';
            recommendationReason = '规则已停用，不建议继续使用';
          }
        } else {
          if (config.status === 'published') {
            publishRecommendation = 'approve';
            recommendationReason = '规则已正式发布';
          } else if (config.status === 'deprecated') {
            publishRecommendation = 'block';
            recommendationReason = '规则已停用，不建议继续使用';
          }
        }

        if (config.status === 'draft') draftCount++;
        else if (config.status === 'trial') trialCount++;
        else if (config.status === 'published') publishedCount++;
        else if (config.status === 'deprecated') deprecatedCount++;

        if (config.status === 'draft' || config.status === 'trial') {
          pendingReviewCount++;
        }

        if (publishRecommendation === 'approve') recommendApproveCount++;
        else if (publishRecommendation === 'caution') recommendCautionCount++;
        else if (publishRecommendation === 'block') recommendBlockCount++;

        totalRules++;

        const isOverridden = this.registry.isOverridden(industry, version);
        const isDefault = this.registry.getDefaultVersion(industry) === version;

        items.push({
          industry,
          version,
          status: config.status,
          description: config.description || '',
          source: config.source || 'custom',
          isDefault,
          isOverridden,
          registeredAt: config.registeredAt,
          publishedAt: config.publishedAt,
          trialStartAt: config.trialStartAt,
          trialEndAt: config.trialEndAt,
          deprecatedAt: config.deprecatedAt,
          lastChange,
          impactSummary,
          publishRecommendation,
          recommendationReason,
          statusHistory,
          requiredFields: config.required || [],
          recommendedFields: config.recommended || [],
          changeLog: config.changeLog,
        });
      }

      items.sort((a, b) => {
        const statusOrder: Record<RuleStatus, number> = {
          draft: 0,
          trial: 1,
          published: 2,
          deprecated: 3,
        };
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return b.version.localeCompare(a.version);
      });

      rulesByIndustry[industry] = items;
    }

    return {
      reviewId: `rule-review-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      industries,
      rulesByIndustry,
      summary: {
        totalRules,
        draftCount,
        trialCount,
        publishedCount,
        deprecatedCount,
        pendingReviewCount,
        recommendApproveCount,
        recommendCautionCount,
        recommendBlockCount,
      },
    };
  }

  private generatePublishRecommendation(
    status: RuleStatus,
    analysis: RuleImpactAnalysisResult
  ): {
    recommendation: RuleReviewItem['publishRecommendation'];
    reason: string;
  } {
    const declinedCount = analysis.gradeChanges.declined;
    const declineRate = analysis.totalProducts > 0 ? (declinedCount / analysis.totalProducts) * 100 : 0;
    const newHighRisks = analysis.newRisks.filter(
      (r) => r.level === 'critical' || r.level === 'high'
    ).length;
    const avgScoreChange = analysis.scoreChanges.averageScoreChange;

    if (newHighRisks > 0) {
      return {
        recommendation: 'block',
        reason: `新增 ${newHighRisks} 项高优先级风险，不建议发布，请先解决这些风险`,
      };
    }

    if (declineRate > 30 || avgScoreChange < -5) {
      return {
        recommendation: 'block',
        reason: `影响过大：${declineRate.toFixed(1)}% 产品等级下降，平均分下降 ${Math.abs(avgScoreChange).toFixed(1)}%，建议先优化规则`,
      };
    }

    if (declineRate > 10 || avgScoreChange < -2) {
      return {
        recommendation: 'caution',
        reason: `有一定影响：${declineRate.toFixed(1)}% 产品等级下降，平均分下降 ${Math.abs(avgScoreChange).toFixed(1)}%，建议灰度发布`,
      };
    }

    if (declinedCount === 0 && analysis.newRisks.length === 0) {
      return {
        recommendation: 'approve',
        reason: '无产品等级下降，无新增风险，可安全发布',
      };
    }

    return {
      recommendation: 'caution',
      reason: `影响较小：${declineRate.toFixed(1)}% 产品等级下降，平均分变化 ${avgScoreChange > 0 ? '+' : ''}${avgScoreChange.toFixed(1)}%，建议小范围发布后观察`,
    };
  }
}
