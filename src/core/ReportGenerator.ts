import { ScoringResult, BatchScoringResult, QualityGrade, RiskLevel } from '../types';

export interface TextReportOptions {
  includeDetails?: boolean;
  includeDimensionScores?: boolean;
  includeRisks?: boolean;
  includeLogs?: boolean;
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
    } = options;

    const lines: string[] = [];

    lines.push('========================================');
    lines.push('      数据要素质量评分报告');
    lines.push('========================================');
    lines.push('');

    lines.push(`数据产品编号: ${result.productId}`);
    lines.push(`评分时间: ${result.metadata.scoredAt}`);
    lines.push(`所属行业: ${result.metadata.industry}`);
    lines.push('');

    const percentage = Math.round((result.totalScore / result.maxScore) * 100);
    lines.push('--- 综合评分 ---');
    lines.push(`综合得分: ${result.totalScore} / ${result.maxScore} (${percentage}%)`);
    lines.push(`质量等级: ${this.getGradeEmoji(result.grade)} ${result.grade}`);
    lines.push('');

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
        const pct = Math.round((dim.score.score / dim.score.maxScore) * 100);
        lines.push(`  ${dim.name.padEnd(12)}: ${String(dim.score.score).padStart(3)}/${dim.score.maxScore} (${pct}%)  [权重: ${dim.weight}]`);
      }
      lines.push('');
    }

    if (includeRisks && result.risks.length > 0) {
      lines.push(`--- 风险项 (共 ${result.risks.length} 项) ---`);

      const critical = result.risks.filter((r) => r.level === 'critical').length;
      const high = result.risks.filter((r) => r.level === 'high').length;
      const medium = result.risks.filter((r) => r.level === 'medium').length;
      const low = result.risks.filter((r) => r.level === 'low').length;

      lines.push(`  严重: ${critical}, 高: ${high}, 中: ${medium}, 低: ${low}`);
      lines.push('');

      for (const risk of result.risks) {
        lines.push(`  [${this.getRiskLevelLabel(risk.level)}] ${risk.message}`);
        lines.push(`      建议: ${risk.suggestion}`);
        if (risk.relatedFields && risk.relatedFields.length > 0) {
          lines.push(`      相关字段: ${risk.relatedFields.join(', ')}`);
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
      lines.push(`  字段完整性:`);
      lines.push(`    必选字段: ${fc.requiredFields.length - fc.missingRequiredFields.length}/${fc.requiredFields.length}`);
      if (fc.missingRequiredFields.length > 0) {
        lines.push(`    缺失必选字段: ${fc.missingRequiredFields.join(', ')}`);
      }
      lines.push(`    字段描述覆盖率: ${fc.fieldsWithDescription.length}/${fc.fieldsWithDescription.length + fc.fieldsWithoutDescription.length}`);

      const sc = result.dimensionScores.sampleCompleteness;
      lines.push(`  样本完整性:`);
      lines.push(`    样本记录数: ${sc.totalSampleRecords}`);
      lines.push(`    总体完整率: ${Math.round(sc.overallCompletionRate * 10000) / 100}%`);
      if (sc.fieldsWithHighMissingRate.length > 0) {
        lines.push(`    高缺失率字段: ${sc.fieldsWithHighMissingRate.join(', ')}`);
      }

      const sf = result.dimensionScores.sensitiveField;
      lines.push(`  敏感字段:`);
      lines.push(`    检测到敏感字段数: ${sf.sensitiveFields.length}`);
      if (sf.sensitiveFields.length > 0) {
        lines.push(`    敏感字段列表:`);
        for (const field of sf.sensitiveFields) {
          lines.push(`      - ${field.fieldName} (${field.description}, 级别: ${field.sensitivityLevel}, 已授权: ${field.hasAuthorization ? '是' : '否'})`);
        }
      }

      const uf = result.dimensionScores.updateFrequency;
      lines.push(`  更新频率:`);
      lines.push(`    当前频率: ${uf.currentFrequency}${uf.isSpecified ? '' : ' (未指定)'}`);
      if (uf.daysSinceLastUpdate !== undefined) {
        lines.push(`    距上次更新: ${uf.daysSinceLastUpdate} 天`);
      }

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

    lines.push(`评分产品总数: ${batchResult.summary.totalItems}`);
    lines.push(`平均得分: ${Math.round(batchResult.summary.averageScore * 100) / 100}`);
    lines.push('');

    lines.push('--- 等级分布 ---');
    const grades: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];
    for (const grade of grades) {
      const count = batchResult.summary.gradeDistribution[grade] || 0;
      const pct = batchResult.summary.totalItems > 0 ? Math.round((count / batchResult.summary.totalItems) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 5));
      lines.push(`  ${grade} ${this.getGradeEmoji(grade)}: ${String(count).padStart(3)} 个 (${pct}%) ${bar}`);
    }
    lines.push('');

    lines.push('--- 各产品评分 ---');
    for (const result of batchResult.results) {
      const pct = Math.round((result.totalScore / result.maxScore) * 100);
      lines.push(`  ${result.productId.padEnd(20)} ${this.getGradeEmoji(result.grade)} ${result.grade}  ${result.totalScore}/${result.maxScore} (${pct}%)  风险: ${result.risks.length} 项`);
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
