import {
  ScoringResult,
  BatchScoringResult,
  QualityGrade,
  RiskLevel,
} from '../types';
import { safePercentage } from '../config';

export interface TextReportOptions {
  includeDetails?: boolean;
  includeDimensionScores?: boolean;
  includeRisks?: boolean;
  includeLogs?: boolean;
  includeEvidence?: boolean;
  includeWeights?: boolean;
}

export interface JsonReportOptions {
  pretty?: boolean;
}

export class ReportGenerator {
  generateTextReport(result: ScoringResult, options: TextReportOptions = {}): string {
    const {
      includeDetails = true,
      includeDimensionScores = true,
      includeRisks = true,
      includeLogs = false,
      includeEvidence = true,
      includeWeights = true,
    } = options;

    const lines: string[] = [];

    lines.push('========================================');
    lines.push('      数据要素质量评分报告');
    lines.push('========================================');
    lines.push('');

    lines.push(`数据产品编号: ${result.productId}`);
    lines.push(`评分时间: ${result.metadata.scoredAt}`);
    lines.push(`所属行业: ${result.metadata.industry}`);
    if (result.metadata.industryConfigVersion) {
      lines.push(`行业规则版本: ${result.metadata.industryConfigVersion}`);
      lines.push(`行业规则说明: ${result.metadata.industryConfigDescription}`);
    }
    lines.push('');

    const percentage = safePercentage(result.totalScore, result.maxScore);
    lines.push('--- 综合评分 ---');
    lines.push(`综合得分: ${result.totalScore} / ${result.maxScore} (${percentage}%)`);
    lines.push(`质量等级: ${this.getGradeEmoji(result.grade)} ${result.grade}`);
    lines.push('');

    if (includeWeights && result.metadata.weightsNormalized) {
      lines.push('⚠️  权重已自动归一化');
      if (result.weightWarnings && result.weightWarnings.length > 0) {
        for (const warning of result.weightWarnings) {
          lines.push(`   • ${warning}`);
        }
      }
      lines.push('');
    }

    if (includeDimensionScores) {
      lines.push('--- 各维度评分 ---');
      const dimensions = [
        { name: '字段完整性', score: result.dimensionScores.fieldCompleteness, weight: result.metadata.weights.fieldCompleteness },
        { name: '样本完整性', score: result.dimensionScores.sampleCompleteness, weight: result.metadata.weights.sampleCompleteness },
        { name: '敏感字段', score: result.dimensionScores.sensitiveField, weight: result.metadata.weights.sensitiveField },
        { name: '更新频率', score: result.dimensionScores.updateFrequency, weight: result.metadata.weights.updateFrequency },
        { name: '描述完整性', score: result.dimensionScores.descriptionCompleteness, weight: result.metadata.weights.descriptionCompleteness },
        { name: '授权范围', score: result.dimensionScores.authorization, weight: result.metadata.weights.authorization },
      ];

      for (const dim of dimensions) {
        const pct = safePercentage(dim.score.score, dim.score.maxScore);
        const indicator = pct >= 80 ? '✅' : pct >= 60 ? '⚠️' : '❌';
        lines.push(`  ${indicator} ${dim.name.padEnd(12)}: ${String(dim.score.score).padStart(3)}/${dim.score.maxScore} (${pct}%)  [权重: ${dim.weight}]`);
      }
      lines.push('');
    }

    if (includeRisks && result.risks.length > 0) {
      lines.push(`--- 风险项 (共 ${result.risks.length} 项) ---`);

      const critical = result.risks.filter((r) => r.level === 'critical').length;
      const high = result.risks.filter((r) => r.level === 'high').length;
      const medium = result.risks.filter((r) => r.level === 'medium').length;
      const low = result.risks.filter((r) => r.level === 'low').length;

      lines.push(`  ❌ 严重: ${critical},  ⚠️  高: ${high},  中: ${medium},  ℹ️  低: ${low}`);
      lines.push('');

      for (const risk of result.risks) {
        const levelLabel = this.getRiskLevelLabel(risk.level);
        const levelEmoji = this.getRiskLevelEmoji(risk.level);
        lines.push(`  ${levelEmoji} [${levelLabel}] ${risk.message}`);
        lines.push(`      建议: ${risk.suggestion}`);
        if (risk.relatedFields && risk.relatedFields.length > 0) {
          lines.push(`      相关字段: ${risk.relatedFields.join(', ')}`);
        }
        if (includeEvidence && risk.evidence && risk.evidence.length > 0) {
          lines.push(`      📋 证据来源:`);
          for (const ev of risk.evidence) {
            const evValue = ev.value !== undefined ? ` → ${ev.value}` : '';
            const evExpected = ev.expected !== undefined ? ` (期望: ${ev.expected})` : '';
            const evFields = ev.fields && ev.fields.length > 0 ? ` [字段: ${ev.fields.join(', ')}]` : '';
            lines.push(`         • ${ev.description}${evValue}${evExpected}${evFields}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('--- 改进建议 ---');
    for (const suggestion of result.suggestions) {
      lines.push(`  • ${suggestion}`);
    }
    lines.push('');

    if (includeDetails) {
      lines.push('--- 详细信息 ---');

      const fc = result.dimensionScores.fieldCompleteness;
      lines.push(`  📝 字段完整性 (${fc.score}/${fc.maxScore}):`);
      if (fc.ruleVersion) {
        lines.push(`    规则版本: ${fc.ruleVersion} - ${fc.ruleDescription}`);
      }
      lines.push(`    必选字段: ${fc.requiredFields.length - fc.missingRequiredFields.length}/${fc.requiredFields.length}`);
      if (fc.missingRequiredFields.length > 0) {
        lines.push(`    ❌ 缺失必选字段: ${fc.missingRequiredFields.join(', ')}`);
      }
      lines.push(`    字段描述覆盖率: ${fc.fieldsWithDescription.length}/${fc.fieldsWithDescription.length + fc.fieldsWithoutDescription.length} (${safePercentage(fc.fieldsWithDescription.length, fc.fieldsWithDescription.length + fc.fieldsWithoutDescription.length)}%)`);
      if (fc.fieldsWithoutDescription.length > 0) {
        lines.push(`    缺少描述的字段: ${fc.fieldsWithoutDescription.join(', ')}`);
      }

      const sc = result.dimensionScores.sampleCompleteness;
      lines.push(`  📊 样本完整性 (${sc.score}/${sc.maxScore}):`);
      lines.push(`    样本记录数: ${sc.totalSampleRecords}`);
      lines.push(`    总体完整率: ${safePercentage(sc.overallCompletionRate * 100, 100)}%`);
      if (sc.fieldsWithHighMissingRate.length > 0) {
        lines.push(`    ❌ 高缺失率字段 (>30%):`);
        for (const field of sc.fieldsWithHighMissingRate) {
          const rate = sc.fieldCompletionRates[field];
          const missingRate = rate !== undefined ? safePercentage((1 - rate) * 100, 100) : '未知';
          lines.push(`       - ${field}: 缺失率 ${missingRate}%`);
        }
      }

      const sf = result.dimensionScores.sensitiveField;
      lines.push(`  🔒 敏感字段 (${sf.score}/${sf.maxScore}):`);
      lines.push(`    检测到敏感字段数: ${sf.sensitiveFields.length}，风险等级: ${this.getRiskLevelEmoji(sf.riskLevel)} ${this.getRiskLevelLabel(sf.riskLevel)}`);
      if (sf.sensitiveFields.length > 0) {
        lines.push(`    敏感字段列表:`);
        for (const field of sf.sensitiveFields) {
          const authIcon = field.hasAuthorization ? '✅' : '❌';
          lines.push(`       - ${field.fieldName} (${field.description}, 级别: ${field.sensitivityLevel}, 已授权: ${authIcon})`);
        }
      }

      const uf = result.dimensionScores.updateFrequency;
      lines.push(`  🔄 更新频率 (${uf.score}/${uf.maxScore}):`);
      lines.push(`    当前频率: ${uf.currentFrequency}${uf.isSpecified ? '' : ' (未指定)'}`);
      if (uf.hasInvalidLastUpdated) {
        lines.push(`    ❌ lastUpdatedAt 无效: "${uf.lastUpdatedRawValue}" — 无法解析为有效日期`);
      } else if (uf.daysSinceLastUpdate !== undefined) {
        lines.push(`    距上次更新: ${uf.daysSinceLastUpdate} 天`);
      } else if (!uf.hasLastUpdated) {
        lines.push(`    ⚠️  未提供最近更新时间`);
      }

      const dc = result.dimensionScores.descriptionCompleteness;
      lines.push(`  📄 描述完整性 (${dc.score}/${dc.maxScore}):`);
      lines.push(`    已提供: ${dc.providedFields.join(', ') || '无'}`);
      if (dc.missingFields.length > 0) {
        lines.push(`    ❌ 缺失: ${dc.missingFields.join(', ')}`);
      }

      const au = result.dimensionScores.authorization;
      lines.push(`  🛡️  授权范围 (${au.score}/${au.maxScore}):`);
      lines.push(`    覆盖程度: ${safePercentage(au.scopeCoverage * 100, 100)}% (使用目的:${au.hasPurpose ? '✅' : '❌'} 保留期限:${au.hasRetention ? '✅' : '❌'})`);

      lines.push('');
    }

    if (includeLogs && result.detailLogs && result.detailLogs.length > 0) {
      lines.push(`--- 明细日志 (共 ${result.detailLogs.length} 条) ---`);
      for (const log of result.detailLogs) {
        lines.push(`  [${log.timestamp}] [${log.level.toUpperCase()}] [${log.module}] ${log.message}`);
      }
      lines.push('');
    }

    lines.push('========================================');
    lines.push('         报告结束');
    lines.push('========================================');

    return lines.join('\n');
  }

  generateJsonReport(result: ScoringResult, options: JsonReportOptions = {}): string {
    const { pretty = true } = options;
    return pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  }

  generateBatchSummaryReport(batchResult: BatchScoringResult): string {
    const lines: string[] = [];

    lines.push('========================================');
    lines.push('   批量数据要素质量评分汇总报告');
    lines.push('========================================');
    lines.push('');

    lines.push(`📊 评分产品总数: ${batchResult.summary.totalItems}`);
    lines.push(`📈 平均得分率: ${safePercentage(batchResult.summary.averageScore * 100, 100)}%`);
    lines.push('');

    lines.push('--- 等级分布 ---');
    const grades: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];
    for (const grade of grades) {
      const count = batchResult.summary.gradeDistribution[grade] || 0;
      const pct = batchResult.summary.totalItems > 0
        ? safePercentage(count, batchResult.summary.totalItems)
        : 0;
      const bar = '█'.repeat(Math.round(pct / 5));
      lines.push(`  ${this.getGradeEmoji(grade)} ${grade.padEnd(2)}: ${String(count).padStart(3)} 个  (${pct}%)  ${bar}`);
    }
    lines.push('');

    if (batchResult.summary.highFrequencyRisks.length > 0) {
      lines.push('--- 🔥 高频风险 TOP 10 (≥ 20% 产品出现) ---');
      for (const risk of batchResult.summary.highFrequencyRisks) {
        const pct = safePercentage(risk.occurrenceCount, batchResult.summary.totalItems);
        const emoji = this.getRiskLevelEmoji(risk.level);
        lines.push(`  ${emoji} [${this.getRiskLevelLabel(risk.level)}] ${risk.message}`);
        lines.push(`       出现: ${risk.occurrenceCount}/${batchResult.summary.totalItems} (${pct}%)`);
        if (risk.affectedProducts.length <= 5) {
          lines.push(`       影响产品: ${risk.affectedProducts.join(', ')}`);
        } else {
          lines.push(`       影响产品: ${risk.affectedProducts.slice(0, 5).join(', ')} 等共 ${risk.affectedProducts.length} 个`);
        }
        lines.push('');
      }
    } else {
      lines.push('--- 🔥 高频风险 ---');
      lines.push('  ✅ 暂无显著高频风险项（低于 20% 阈值）');
      lines.push('');
    }

    if (batchResult.summary.lowScoringDimensions.length > 0) {
      lines.push('--- ⚠️  低分维度分析 (< 60%) ---');
      for (const dim of batchResult.summary.lowScoringDimensions) {
        const pct = batchResult.summary.totalItems > 0
          ? safePercentage(dim.belowThresholdCount, batchResult.summary.totalItems)
          : 0;
        lines.push(`  📉 ${dim.dimension}: 平均分 ${dim.averageScore}%，${dim.belowThresholdCount}/${batchResult.summary.totalItems} (${pct}%) 产品低于 60 分`);
        if (dim.affectedProducts.length <= 5) {
          lines.push(`       低分产品: ${dim.affectedProducts.join(', ')}`);
        } else {
          lines.push(`       低分产品: ${dim.affectedProducts.slice(0, 5).join(', ')} 等共 ${dim.affectedProducts.length} 个`);
        }
      }
      lines.push('');
    }

    lines.push('--- 各产品评分概览 ---');
    for (const result of batchResult.results) {
      const pct = safePercentage(result.totalScore, result.maxScore);
      const indicator = result.grade === 'S' || result.grade === 'A' ? '✅' : result.grade === 'B' ? '👍' : result.grade === 'C' ? '⚠️' : '❌';
      lines.push(`  ${result.productId.padEnd(24)} ${this.getGradeEmoji(result.grade)} ${result.grade}  ${String(result.totalScore).padStart(3)}/${result.maxScore} (${pct}%)  风险:${String(result.risks.length).padStart(2)}项 ${indicator}`);
    }
    lines.push('');

    lines.push('========================================');

    return lines.join('\n');
  }

  private getGradeEmoji(grade: QualityGrade): string {
    const emojis: Record<QualityGrade, string> = {
      S: '🌟',
      A: '✅',
      B: '👍',
      C: '⚠️',
      D: '❌',
    };
    return emojis[grade] || '';
  }

  private getRiskLevelEmoji(level: RiskLevel): string {
    const emojis: Record<RiskLevel, string> = {
      critical: '🔥',
      high: '⚠️',
      medium: '⚡',
      low: 'ℹ️',
    };
    return emojis[level] || '';
  }

  private getRiskLevelLabel(level: RiskLevel): string {
    const labels: Record<RiskLevel, string> = {
      critical: '严重',
      high: '高',
      medium: '中',
      low: '低',
    };
    return labels[level] || level;
  }
}
