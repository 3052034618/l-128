import {
  ScoringResult,
  BatchScoringResult,
  QualityGrade,
  RiskLevel,
  AuditSummaryReport,
  ZeroWeightDimension,
  RuleFallbackInfo,
  RiskItem,
  ScoringComparisonResult,
  AuditDeliveryPackage,
  MultiScoringComparisonResult,
  RuleImpactAnalysisResult,
  RuleStatus,
  IndustryType,
} from '../types';
import {
  safePercentage,
  DEFAULT_AUDIT_PASS_THRESHOLD,
  DIMENSION_NAMES,
  LOW_SCORE_THRESHOLD,
} from '../config';
import { IndustryRuleRegistry } from './IndustryRuleRegistry';

export interface TextReportOptions {
  includeDetails?: boolean;
  includeDimensionScores?: boolean;
  includeRisks?: boolean;
  includeLogs?: boolean;
  includeEvidence?: boolean;
  includeWeights?: boolean;
  format?: 'text' | 'markdown';
}

export interface JsonReportOptions {
  pretty?: boolean;
}

export interface AuditReportOptions {
  passThreshold?: number;
  format?: 'text' | 'markdown';
}

export class ReportGenerator {
  private formatStatusTransition(fromStatus: RuleStatus | null, toStatus: RuleStatus): string {
    if (fromStatus === null) {
      return `创建 → ${toStatus}`;
    }
    return `${fromStatus} → ${toStatus}`;
  }

  generateTextReport(result: ScoringResult, options: TextReportOptions = {}): string {
    const {
      includeDetails = true,
      includeDimensionScores = true,
      includeRisks = true,
      includeLogs = false,
      includeEvidence = true,
      includeWeights = true,
      format = 'text',
    } = options;

    return format === 'markdown'
      ? this.generateTextReportMarkdown(result, {
          includeDetails,
          includeDimensionScores,
          includeRisks,
          includeLogs,
          includeEvidence,
          includeWeights,
        })
      : this.generateTextReportPlain(result, {
          includeDetails,
          includeDimensionScores,
          includeRisks,
          includeLogs,
          includeEvidence,
          includeWeights,
        });
  }

  private generateTextReportPlain(result: ScoringResult, options: Omit<TextReportOptions, 'format'>): string {
    const {
      includeDetails,
      includeDimensionScores,
      includeRisks,
      includeLogs,
      includeEvidence,
      includeWeights,
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
      lines.push(`行业规则来源: ${result.metadata.industryConfigSource || 'built-in'}`);
    }
    if (result.ruleFallbackInfo) {
      lines.push(`⚠️  规则回退: ${result.ruleFallbackInfo.reason}`);
    }
    lines.push('');

    const percentage = safePercentage(result.totalScore, result.maxScore);
    lines.push('--- 综合评分 ---');
    lines.push(`综合得分: ${result.totalScore} / ${result.maxScore} (${percentage}%)`);
    lines.push(`质量等级: ${this.getGradeEmoji(result.grade)} ${result.grade}`);
    lines.push('');

    if (result.zeroWeightDimensions && result.zeroWeightDimensions.length > 0) {
      lines.push('⚠️  零权重维度（不计入总分）:');
      for (const zw of result.zeroWeightDimensions) {
        const strategy = zw.handlingStrategy === 'exclude' ? '已排除，不参与评分' : '权重为0，不影响总分';
        lines.push(`   • ${zw.dimensionName} (${zw.dimensionKey}): ${strategy}`);
        lines.push(`     ${zw.note}`);
      }
      lines.push('');
    }

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
        { name: '字段完整性', score: result.dimensionScores.fieldCompleteness, weight: result.metadata.weights.fieldCompleteness, key: 'fieldCompleteness' as const },
        { name: '样本完整性', score: result.dimensionScores.sampleCompleteness, weight: result.metadata.weights.sampleCompleteness, key: 'sampleCompleteness' as const },
        { name: '敏感字段', score: result.dimensionScores.sensitiveField, weight: result.metadata.weights.sensitiveField, key: 'sensitiveField' as const },
        { name: '更新频率', score: result.dimensionScores.updateFrequency, weight: result.metadata.weights.updateFrequency, key: 'updateFrequency' as const },
        { name: '描述完整性', score: result.dimensionScores.descriptionCompleteness, weight: result.metadata.weights.descriptionCompleteness, key: 'descriptionCompleteness' as const },
        { name: '授权范围', score: result.dimensionScores.authorization, weight: result.metadata.weights.authorization, key: 'authorization' as const },
      ];

      for (const dim of dimensions) {
        const pct = safePercentage(dim.score.score, dim.score.maxScore);
        const isZeroWeight = result.zeroWeightDimensions?.some((z) => z.dimensionKey === dim.key);
        const indicator = isZeroWeight ? '⚪' : pct >= 80 ? '✅' : pct >= 60 ? '⚠️' : '❌';
        const zeroLabel = isZeroWeight ? ' [零权重，不计入]' : '';
        lines.push(`  ${indicator} ${dim.name.padEnd(12)}: ${String(dim.score.score).padStart(3)}/${dim.score.maxScore} (${pct}%)  [权重: ${dim.weight}]${zeroLabel}`);
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

  private generateTextReportMarkdown(result: ScoringResult, options: Omit<TextReportOptions, 'format'>): string {
    const {
      includeDetails,
      includeDimensionScores,
      includeRisks,
      includeLogs,
      includeEvidence,
      includeWeights,
    } = options;
    const lines: string[] = [];

    lines.push('# 数据要素质量评分报告');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 基本信息');
    lines.push('');
    lines.push(`| 项目 | 内容 |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 数据产品编号 | ${result.productId} |`);
    lines.push(`| 评分时间 | ${result.metadata.scoredAt} |`);
    lines.push(`| 所属行业 | ${result.metadata.industry} |`);
    if (result.metadata.industryConfigVersion) {
      lines.push(`| 行业规则版本 | ${result.metadata.industryConfigVersion} |`);
      lines.push(`| 行业规则说明 | ${result.metadata.industryConfigDescription} |`);
      lines.push(`| 行业规则来源 | ${result.metadata.industryConfigSource || 'built-in'} |`);
    }
    if (result.ruleFallbackInfo) {
      lines.push(`| ⚠️ 规则回退 | ${result.ruleFallbackInfo.reason} |`);
    }
    lines.push('');

    const percentage = safePercentage(result.totalScore, result.maxScore);
    lines.push('## 综合评分');
    lines.push('');
    lines.push(`**综合得分**: ${result.totalScore} / ${result.maxScore} (${percentage}%)  `);
    lines.push(`**质量等级**: ${this.getGradeEmoji(result.grade)} **${result.grade}**  `);
    lines.push('');

    if (result.zeroWeightDimensions && result.zeroWeightDimensions.length > 0) {
      lines.push('> ⚠️ **零权重维度（不计入总分）**');
      lines.push('');
      for (const zw of result.zeroWeightDimensions) {
        const strategy = zw.handlingStrategy === 'exclude' ? '已排除，不参与评分' : '权重为0，不影响总分';
        lines.push(`- **${zw.dimensionName}** (${zw.dimensionKey}): ${strategy}`);
        lines.push(`  - ${zw.note}`);
      }
      lines.push('');
    }

    if (includeWeights && result.metadata.weightsNormalized) {
      lines.push('> ⚠️ **权重已自动归一化**');
      lines.push('');
      if (result.weightWarnings && result.weightWarnings.length > 0) {
        for (const warning of result.weightWarnings) {
          lines.push(`- ${warning}`);
        }
      }
      lines.push('');
    }

    if (includeDimensionScores) {
      lines.push('## 各维度评分');
      lines.push('');
      lines.push('| 维度 | 得分 | 权重 | 状态 |');
      lines.push('| :--- | :---: | :---: | :--- |');

      const dimensions = [
        { name: '字段完整性', score: result.dimensionScores.fieldCompleteness, weight: result.metadata.weights.fieldCompleteness, key: 'fieldCompleteness' as const },
        { name: '样本完整性', score: result.dimensionScores.sampleCompleteness, weight: result.metadata.weights.sampleCompleteness, key: 'sampleCompleteness' as const },
        { name: '敏感字段', score: result.dimensionScores.sensitiveField, weight: result.metadata.weights.sensitiveField, key: 'sensitiveField' as const },
        { name: '更新频率', score: result.dimensionScores.updateFrequency, weight: result.metadata.weights.updateFrequency, key: 'updateFrequency' as const },
        { name: '描述完整性', score: result.dimensionScores.descriptionCompleteness, weight: result.metadata.weights.descriptionCompleteness, key: 'descriptionCompleteness' as const },
        { name: '授权范围', score: result.dimensionScores.authorization, weight: result.metadata.weights.authorization, key: 'authorization' as const },
      ];

      for (const dim of dimensions) {
        const pct = safePercentage(dim.score.score, dim.score.maxScore);
        const isZeroWeight = result.zeroWeightDimensions?.some((z) => z.dimensionKey === dim.key);
        const indicator = isZeroWeight ? '⚪ 零权重' : pct >= 80 ? '✅ 良好' : pct >= 60 ? '⚠️ 一般' : '❌ 较差';
        lines.push(`| ${dim.name} | ${dim.score.score}/${dim.score.maxScore} (${pct}%) | ${dim.weight} | ${indicator} |`);
      }
      lines.push('');
    }

    if (includeRisks && result.risks.length > 0) {
      lines.push('## 风险项');
      lines.push('');
      const critical = result.risks.filter((r) => r.level === 'critical').length;
      const high = result.risks.filter((r) => r.level === 'high').length;
      const medium = result.risks.filter((r) => r.level === 'medium').length;
      const low = result.risks.filter((r) => r.level === 'low').length;
      lines.push(`**风险统计**: ❌ 严重: ${critical} | ⚠️ 高: ${high} | ⚡ 中: ${medium} | ℹ️ 低: ${low}  `);
      lines.push(`共 ${result.risks.length} 项风险`);
      lines.push('');

      for (const risk of result.risks) {
        const levelLabel = this.getRiskLevelLabel(risk.level);
        const levelEmoji = this.getRiskLevelEmoji(risk.level);
        lines.push(`### ${levelEmoji} [${levelLabel}] ${risk.message}`);
        lines.push('');
        lines.push(`**建议**: ${risk.suggestion}  `);
        if (risk.relatedFields && risk.relatedFields.length > 0) {
          lines.push(`**相关字段**: \`${risk.relatedFields.join('`, `')}\`  `);
        }
        if (includeEvidence && risk.evidence && risk.evidence.length > 0) {
          lines.push('');
          lines.push('**📋 证据来源**:');
          lines.push('');
          for (const ev of risk.evidence) {
            const evValue = ev.value !== undefined ? ` → ${ev.value}` : '';
            const evExpected = ev.expected !== undefined ? ` (期望: ${ev.expected})` : '';
            const evFields = ev.fields && ev.fields.length > 0 ? ` [字段: ${ev.fields.join(', ')}]` : '';
            lines.push(`- ${ev.description}${evValue}${evExpected}${evFields}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('## 改进建议');
    lines.push('');
    for (const suggestion of result.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push('');

    if (includeDetails) {
      lines.push('## 详细信息');
      lines.push('');

      const fc = result.dimensionScores.fieldCompleteness;
      lines.push('### 📝 字段完整性');
      lines.push(`**得分**: ${fc.score}/${fc.maxScore}  `);
      if (fc.ruleVersion) {
        lines.push(`**规则版本**: ${fc.ruleVersion} - ${fc.ruleDescription}  `);
      }
      lines.push(`**必选字段**: ${fc.requiredFields.length - fc.missingRequiredFields.length}/${fc.requiredFields.length}  `);
      if (fc.missingRequiredFields.length > 0) {
        lines.push(`**❌ 缺失必选字段**: \`${fc.missingRequiredFields.join('`, `')}\`  `);
      }
      lines.push(`**字段描述覆盖率**: ${fc.fieldsWithDescription.length}/${fc.fieldsWithDescription.length + fc.fieldsWithoutDescription.length} (${safePercentage(fc.fieldsWithDescription.length, fc.fieldsWithDescription.length + fc.fieldsWithoutDescription.length)}%)  `);
      if (fc.fieldsWithoutDescription.length > 0) {
        lines.push(`**缺少描述的字段**: \`${fc.fieldsWithoutDescription.join('`, `')}\`  `);
      }
      lines.push('');

      const sc = result.dimensionScores.sampleCompleteness;
      lines.push('### 📊 样本完整性');
      lines.push(`**得分**: ${sc.score}/${sc.maxScore}  `);
      lines.push(`**样本记录数**: ${sc.totalSampleRecords}  `);
      lines.push(`**总体完整率**: ${safePercentage(sc.overallCompletionRate * 100, 100)}%  `);
      if (sc.fieldsWithHighMissingRate.length > 0) {
        lines.push('**❌ 高缺失率字段 (>30%)**:');
        lines.push('');
        for (const field of sc.fieldsWithHighMissingRate) {
          const rate = sc.fieldCompletionRates[field];
          const missingRate = rate !== undefined ? safePercentage((1 - rate) * 100, 100) : '未知';
          lines.push(`- ${field}: 缺失率 ${missingRate}%`);
        }
      }
      lines.push('');

      const sf = result.dimensionScores.sensitiveField;
      lines.push('### 🔒 敏感字段');
      lines.push(`**得分**: ${sf.score}/${sf.maxScore}  `);
      lines.push(`**检测到敏感字段数**: ${sf.sensitiveFields.length}，风险等级: ${this.getRiskLevelEmoji(sf.riskLevel)} ${this.getRiskLevelLabel(sf.riskLevel)}  `);
      if (sf.sensitiveFields.length > 0) {
        lines.push('');
        lines.push('| 字段名 | 描述 | 敏感度级别 | 已授权 |');
        lines.push('| :--- | :--- | :---: | :---: |');
        for (const field of sf.sensitiveFields) {
          const authIcon = field.hasAuthorization ? '✅' : '❌';
          lines.push(`| ${field.fieldName} | ${field.description} | ${field.sensitivityLevel} | ${authIcon} |`);
        }
      }
      lines.push('');

      const uf = result.dimensionScores.updateFrequency;
      lines.push('### 🔄 更新频率');
      lines.push(`**得分**: ${uf.score}/${uf.maxScore}  `);
      lines.push(`**当前频率**: ${uf.currentFrequency}${uf.isSpecified ? '' : ' (未指定)'}  `);
      if (uf.hasInvalidLastUpdated) {
        lines.push(`**❌ lastUpdatedAt 无效**: \`${uf.lastUpdatedRawValue}\` — 无法解析为有效日期  `);
      } else if (uf.daysSinceLastUpdate !== undefined) {
        lines.push(`**距上次更新**: ${uf.daysSinceLastUpdate} 天  `);
      } else if (!uf.hasLastUpdated) {
        lines.push(`**⚠️ 未提供最近更新时间**  `);
      }
      lines.push('');

      const dc = result.dimensionScores.descriptionCompleteness;
      lines.push('### 📄 描述完整性');
      lines.push(`**得分**: ${dc.score}/${dc.maxScore}  `);
      lines.push(`**已提供**: ${dc.providedFields.join(', ') || '无'}  `);
      if (dc.missingFields.length > 0) {
        lines.push(`**❌ 缺失**: \`${dc.missingFields.join('`, `')}\`  `);
      }
      lines.push('');

      const au = result.dimensionScores.authorization;
      lines.push('### 🛡️ 授权范围');
      lines.push(`**得分**: ${au.score}/${au.maxScore}  `);
      lines.push(`**覆盖程度**: ${safePercentage(au.scopeCoverage * 100, 100)}% (使用目的:${au.hasPurpose ? '✅' : '❌'} 保留期限:${au.hasRetention ? '✅' : '❌'})  `);
      lines.push('');
    }

    if (includeLogs && result.detailLogs && result.detailLogs.length > 0) {
      lines.push('## 明细日志');
      lines.push('');
      lines.push('| 时间 | 级别 | 模块 | 消息 |');
      lines.push('| :--- | :--- | :--- | :--- |');
      for (const log of result.detailLogs) {
        lines.push(`| ${log.timestamp} | ${log.level.toUpperCase()} | ${log.module} | ${log.message} |`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*报告结束*');

    return lines.join('\n');
  }

  generateJsonReport(result: ScoringResult, options: JsonReportOptions = {}): string {
    const { pretty = true } = options;
    return pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  }

  generateMarkdownReport(result: ScoringResult, options?: Omit<TextReportOptions, 'format'>): string {
    return this.generateTextReport(result, { ...options, format: 'markdown' });
  }

  generateAuditSummaryReport(
    result: ScoringResult,
    options: AuditReportOptions = {}
  ): AuditSummaryReport {
    const { passThreshold = DEFAULT_AUDIT_PASS_THRESHOLD } = options;
    const percentage = safePercentage(result.totalScore, result.maxScore);

    const criticalFailures = result.risks.filter((r) => r.level === 'critical');
    const highPriority = result.risks.filter((r) => r.level === 'high');
    const mediumPriority = result.risks.filter((r) => r.level === 'medium');

    let overallResult: 'PASS' | 'FAIL' | 'WARNING';
    if (percentage < passThreshold || criticalFailures.length > 0) {
      overallResult = 'FAIL';
    } else if (highPriority.length > 0 || percentage < passThreshold + 10) {
      overallResult = 'WARNING';
    } else {
      overallResult = 'PASS';
    }

    const keyEvidence = result.risks
      .filter((r) => r.evidence && r.evidence.length > 0 && r.level !== 'low')
      .map((r) => ({
        description: r.message,
        evidence: r.evidence!,
      }));

    const rectificationPlan = this.buildRectificationPlan(criticalFailures, highPriority, mediumPriority);

    return {
      productId: result.productId,
      productName: result.dimensionScores.descriptionCompleteness.providedFields.includes('productName')
        ? result.dimensionScores.descriptionCompleteness.providedFields.join(', ')
        : undefined,
      scoredAt: result.metadata.scoredAt,
      overallResult,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      grade: result.grade,
      passThreshold,
      criticalFailures,
      highPriorityRisks: highPriority,
      mediumPriorityRisks: mediumPriority,
      keyEvidence,
      rectificationPlan,
      ruleInfo: {
        industry: result.metadata.industry,
        version: result.metadata.industryConfigVersion || 'unknown',
        description: result.metadata.industryConfigDescription || 'unknown',
        source: result.metadata.industryConfigSource || 'built-in',
        fallbackInfo: result.ruleFallbackInfo,
      },
    };
  }

  generateAuditSummaryText(result: ScoringResult, options: AuditReportOptions = {}): string {
    const audit = this.generateAuditSummaryReport(result, options);
    const { format = 'text' } = options;

    return format === 'markdown'
      ? this.formatAuditReportMarkdown(audit)
      : this.formatAuditReportPlain(audit);
  }

  generateAuditSummaryMarkdown(result: ScoringResult, options?: Omit<AuditReportOptions, 'format'>): string {
    return this.generateAuditSummaryText(result, { ...options, format: 'markdown' });
  }

  private buildRectificationPlan(
    critical: RiskItem[],
    high: RiskItem[],
    medium: RiskItem[]
  ): AuditSummaryReport['rectificationPlan'] {
    const plan: AuditSummaryReport['rectificationPlan'] = [];

    if (critical.length > 0) {
      plan.push({
        priority: 'critical',
        action: `立即修复 ${critical.length} 个严重风险项：${critical.map((r) => r.message).join('；')}`,
        relatedRisks: critical.map((r) => r.id),
        expectedImpact: `消除上架否决项，风险等级降低至可接受范围`,
      });
    }

    if (high.length > 0) {
      plan.push({
        priority: 'high',
        action: `优先修复 ${high.length} 个高风险项：${high.map((r) => r.message).join('；')}`,
        relatedRisks: high.map((r) => r.id),
        expectedImpact: `显著提升数据质量得分，达到上架基本要求`,
      });
    }

    if (medium.length > 0) {
      plan.push({
        priority: 'medium',
        action: `建议改进 ${medium.length} 个中等风险项：${medium.map((r) => r.message).slice(0, 3).join('；')}${medium.length > 3 ? ' 等' : ''}`,
        relatedRisks: medium.map((r) => r.id),
        expectedImpact: `进一步提升数据质量至优秀水平`,
      });
    }

    return plan;
  }

  private formatAuditReportPlain(audit: AuditSummaryReport): string {
    const lines: string[] = [];
    const percentage = safePercentage(audit.totalScore, audit.maxScore);
    const resultEmoji = audit.overallResult === 'PASS' ? '✅' : audit.overallResult === 'WARNING' ? '⚠️' : '❌';

    lines.push('========================================');
    lines.push('      数据要素上架审核摘要报告');
    lines.push('========================================');
    lines.push('');
    lines.push(`数据产品编号: ${audit.productId}`);
    lines.push(`审核时间: ${audit.scoredAt}`);
    lines.push(`审核结果: ${resultEmoji} ${audit.overallResult}`);
    lines.push(`综合得分: ${audit.totalScore} / ${audit.maxScore} (${percentage}%)`);
    lines.push(`质量等级: ${this.getGradeEmoji(audit.grade)} ${audit.grade}`);
    lines.push(`通过阈值: ${audit.passThreshold}%`);
    lines.push('');

    lines.push(`--- 规则信息 ---`);
    lines.push(`行业: ${audit.ruleInfo.industry}`);
    lines.push(`版本: ${audit.ruleInfo.version}`);
    lines.push(`说明: ${audit.ruleInfo.description}`);
    lines.push(`来源: ${audit.ruleInfo.source}`);
    if (audit.ruleInfo.fallbackInfo) {
      lines.push(`⚠️  规则回退: ${audit.ruleInfo.fallbackInfo.reason}`);
    }
    lines.push('');

    if (audit.criticalFailures.length > 0) {
      lines.push(`--- ❌ 不通过原因 (严重风险 ${audit.criticalFailures.length} 项) ---`);
      for (const risk of audit.criticalFailures) {
        lines.push(`  🔥 [严重] ${risk.message}`);
        lines.push(`     建议: ${risk.suggestion}`);
        if (risk.relatedFields) {
          lines.push(`     字段: ${risk.relatedFields.join(', ')}`);
        }
      }
      lines.push('');
    }

    if (audit.highPriorityRisks.length > 0) {
      lines.push(`--- ⚠️  高优先级整改 (${audit.highPriorityRisks.length} 项) ---`);
      for (const risk of audit.highPriorityRisks) {
        lines.push(`  ⚠️  [高] ${risk.message}`);
        lines.push(`     建议: ${risk.suggestion}`);
      }
      lines.push('');
    }

    if (audit.keyEvidence.length > 0) {
      lines.push(`--- 📋 关键证据 ---`);
      for (const ev of audit.keyEvidence.slice(0, 5)) {
        lines.push(`  • ${ev.description}`);
        for (const e of ev.evidence.slice(0, 2)) {
          lines.push(`    → ${e.description}: ${e.value !== undefined ? e.value : ''}`);
        }
      }
      lines.push('');
    }

    if (audit.rectificationPlan.length > 0) {
      lines.push(`--- 📝 整改优先级计划 ---`);
      for (const item of audit.rectificationPlan) {
        const pEmoji = item.priority === 'critical' ? '🔥' : item.priority === 'high' ? '⚠️' : '⚡';
        lines.push(`  ${pEmoji} [${this.getRiskLevelLabel(item.priority)}] ${item.action}`);
        lines.push(`     预期效果: ${item.expectedImpact}`);
      }
      lines.push('');
    }

    lines.push('========================================');
    return lines.join('\n');
  }

  private formatAuditReportMarkdown(audit: AuditSummaryReport): string {
    const lines: string[] = [];
    const percentage = safePercentage(audit.totalScore, audit.maxScore);
    const resultEmoji = audit.overallResult === 'PASS' ? '✅' : audit.overallResult === 'WARNING' ? '⚠️' : '❌';

    lines.push('# 数据要素上架审核摘要报告');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 基本信息');
    lines.push('');
    lines.push(`| 项目 | 内容 |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 数据产品编号 | ${audit.productId} |`);
    lines.push(`| 审核时间 | ${audit.scoredAt} |`);
    lines.push(`| **审核结果** | **${resultEmoji} ${audit.overallResult}** |`);
    lines.push(`| 综合得分 | ${audit.totalScore} / ${audit.maxScore} (${percentage}%) |`);
    lines.push(`| 质量等级 | ${this.getGradeEmoji(audit.grade)} **${audit.grade}** |`);
    lines.push(`| 通过阈值 | ${audit.passThreshold}% |`);
    lines.push('');

    lines.push('## 规则信息');
    lines.push('');
    lines.push(`| 项目 | 内容 |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 行业 | ${audit.ruleInfo.industry} |`);
    lines.push(`| 版本 | ${audit.ruleInfo.version} |`);
    lines.push(`| 说明 | ${audit.ruleInfo.description} |`);
    lines.push(`| 来源 | ${audit.ruleInfo.source} |`);
    if (audit.ruleInfo.fallbackInfo) {
      lines.push(`| ⚠️ 规则回退 | ${audit.ruleInfo.fallbackInfo.reason} |`);
    }
    lines.push('');

    if (audit.criticalFailures.length > 0) {
      lines.push(`## ❌ 不通过原因 (严重风险 ${audit.criticalFailures.length} 项)`);
      lines.push('');
      for (const risk of audit.criticalFailures) {
        lines.push(`### 🔥 [严重] ${risk.message}`);
        lines.push('');
        lines.push(`**建议**: ${risk.suggestion}  `);
        if (risk.relatedFields) {
          lines.push(`**相关字段**: \`${risk.relatedFields.join('`, `')}\`  `);
        }
        lines.push('');
      }
    }

    if (audit.highPriorityRisks.length > 0) {
      lines.push(`## ⚠️ 高优先级整改 (${audit.highPriorityRisks.length} 项)`);
      lines.push('');
      for (const risk of audit.highPriorityRisks) {
        lines.push(`### ⚠️ [高] ${risk.message}`);
        lines.push('');
        lines.push(`**建议**: ${risk.suggestion}  `);
        if (risk.relatedFields) {
          lines.push(`**相关字段**: \`${risk.relatedFields.join('`, `')}\`  `);
        }
        lines.push('');
      }
    }

    if (audit.keyEvidence.length > 0) {
      lines.push(`## 📋 关键证据`);
      lines.push('');
      for (const ev of audit.keyEvidence.slice(0, 5)) {
        lines.push(`### ${ev.description}`);
        lines.push('');
        for (const e of ev.evidence.slice(0, 3)) {
          const evValue = e.value !== undefined ? ` → ${e.value}` : '';
          const evFields = e.fields && e.fields.length > 0 ? ` [字段: ${e.fields.join(', ')}]` : '';
          lines.push(`- ${e.description}${evValue}${evFields}`);
        }
        lines.push('');
      }
    }

    if (audit.rectificationPlan.length > 0) {
      lines.push(`## 📝 整改优先级计划`);
      lines.push('');
      lines.push('| 优先级 | 整改动作 | 预期效果 |');
      lines.push('| :--- | :--- | :--- |');
      for (const item of audit.rectificationPlan) {
        const pEmoji = item.priority === 'critical' ? '🔥' : item.priority === 'high' ? '⚠️' : '⚡';
        lines.push(`| ${pEmoji} ${this.getRiskLevelLabel(item.priority)} | ${item.action} | ${item.expectedImpact} |`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*审核报告结束*');
    return lines.join('\n');
  }

  generateComparisonReport(
    comparison: ScoringComparisonResult,
    options: { format?: 'text' | 'markdown' } = {}
  ): string {
    return options.format === 'markdown'
      ? this.formatComparisonMarkdown(comparison)
      : this.formatComparisonPlain(comparison);
  }

  private formatComparisonPlain(cmp: ScoringComparisonResult): string {
    const lines: string[] = [];
    const diffEmoji = cmp.totalScoreDiff > 0 ? '📈' : cmp.totalScoreDiff < 0 ? '📉' : '➖';
    const gradeEmoji = cmp.gradeChanged ? '🔄' : '➖';

    lines.push('========================================');
    lines.push('         评分结果对比报告');
    lines.push('========================================');
    lines.push('');
    lines.push(`数据产品编号: ${cmp.productId}`);
    lines.push(`对比时间: ${cmp.scoredAt}`);
    lines.push(`对比方案: [${cmp.labelA}] vs [${cmp.labelB}]`);
    lines.push('');

    lines.push('--- 综合结果 ---');
    lines.push(`  ${cmp.labelA.padEnd(20)}: ${cmp.totalScoreA} 分, 等级 ${cmp.gradeA}`);
    lines.push(`  ${cmp.labelB.padEnd(20)}: ${cmp.totalScoreB} 分, 等级 ${cmp.gradeB}`);
    lines.push(`  ${'总分变化'.padEnd(20)}: ${diffEmoji} ${cmp.totalScoreDiff > 0 ? '+' : ''}${cmp.totalScoreDiff} 分`);
    lines.push(`  ${'等级变化'.padEnd(20)}: ${gradeEmoji} ${cmp.gradeChanged ? `${cmp.gradeA} → ${cmp.gradeB}` : '未变化'}`);
    lines.push('');

    lines.push('--- 规则配置 ---');
    lines.push(`  ${cmp.labelA}: 行业=${cmp.ruleInfoA.industry}, 版本=${cmp.ruleInfoA.version}`);
    lines.push(`  ${cmp.labelB}: 行业=${cmp.ruleInfoB.industry}, 版本=${cmp.ruleInfoB.version}`);
    lines.push('');

    lines.push('--- 维度变化 ---');
    if (cmp.improvedDimensions.length > 0) {
      lines.push('  📈 提升维度:');
      for (const d of cmp.improvedDimensions) {
        lines.push(`     • ${d.dimension}: ${d.scoreA} → ${d.scoreB} (+${d.scoreDiff})`);
      }
    }
    if (cmp.worsenedDimensions.length > 0) {
      lines.push('  📉 下降维度:');
      for (const d of cmp.worsenedDimensions) {
        lines.push(`     • ${d.dimension}: ${d.scoreA} → ${d.scoreB} (${d.scoreDiff})`);
      }
    }
    if (cmp.unchangedDimensions.length > 0) {
      lines.push('  ➖ 无变化维度:');
      lines.push(`     • ${cmp.unchangedDimensions.map((d) => d.dimension).join(', ')}`);
    }
    lines.push('');

    lines.push('--- 风险变化 ---');
    if (cmp.newRisks.length > 0) {
      lines.push(`  ➕ 新增风险 (${cmp.newRisks.length} 项):`);
      for (const r of cmp.newRisks.slice(0, 5)) {
        lines.push(`     • [${this.getRiskLevelLabel(r.levelB!)}] ${r.message}`);
      }
      if (cmp.newRisks.length > 5) {
        lines.push(`     等共 ${cmp.newRisks.length} 项`);
      }
    }
    if (cmp.resolvedRisks.length > 0) {
      lines.push(`  ✅ 已解决风险 (${cmp.resolvedRisks.length} 项):`);
      for (const r of cmp.resolvedRisks.slice(0, 5)) {
        lines.push(`     • [${this.getRiskLevelLabel(r.levelA!)}] ${r.message}`);
      }
      if (cmp.resolvedRisks.length > 5) {
        lines.push(`     等共 ${cmp.resolvedRisks.length} 项`);
      }
    }
    if (cmp.levelIncreasedRisks.length > 0) {
      lines.push(`  ⚡ 风险等级上升 (${cmp.levelIncreasedRisks.length} 项):`);
      for (const r of cmp.levelIncreasedRisks.slice(0, 5)) {
        lines.push(`     • ${r.message}: ${this.getRiskLevelLabel(r.levelA!)} → ${this.getRiskLevelLabel(r.levelB!)}`);
      }
    }
    if (cmp.levelDecreasedRisks.length > 0) {
      lines.push(`  📉 风险等级下降 (${cmp.levelDecreasedRisks.length} 项):`);
      for (const r of cmp.levelDecreasedRisks.slice(0, 5)) {
        lines.push(`     • ${r.message}: ${this.getRiskLevelLabel(r.levelA!)} → ${this.getRiskLevelLabel(r.levelB!)}`);
      }
    }
    lines.push('');

    lines.push('========================================');
    return lines.join('\n');
  }

  private formatComparisonMarkdown(cmp: ScoringComparisonResult): string {
    const lines: string[] = [];
    const diffEmoji = cmp.totalScoreDiff > 0 ? '📈' : cmp.totalScoreDiff < 0 ? '📉' : '➖';

    lines.push('# 评分结果对比报告');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 基本信息');
    lines.push('');
    lines.push(`| 项目 | 内容 |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 数据产品编号 | ${cmp.productId} |`);
    lines.push(`| 对比时间 | ${cmp.scoredAt} |`);
    lines.push(`| 对比方案 | **[${cmp.labelA}]** vs **[${cmp.labelB}]** |`);
    lines.push('');

    lines.push('## 综合结果对比');
    lines.push('');
    lines.push('| 指标 | ' + cmp.labelA + ' | ' + cmp.labelB + ' | 变化 |');
    lines.push('| :--- | :---: | :---: | :---: |');
    lines.push(`| 总分 | ${cmp.totalScoreA} | ${cmp.totalScoreB} | ${diffEmoji} ${cmp.totalScoreDiff > 0 ? '+' : ''}${cmp.totalScoreDiff} |`);
    lines.push(`| 等级 | ${this.getGradeEmoji(cmp.gradeA)} ${cmp.gradeA} | ${this.getGradeEmoji(cmp.gradeB)} ${cmp.gradeB} | ${cmp.gradeChanged ? '🔄 变化' : '➖ 未变'} |`);
    lines.push('');

    lines.push('## 规则配置对比');
    lines.push('');
    lines.push('| 方案 | 行业 | 规则版本 | 说明 |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push(`| ${cmp.labelA} | ${cmp.ruleInfoA.industry} | ${cmp.ruleInfoA.version} | ${cmp.ruleInfoA.description} |`);
    lines.push(`| ${cmp.labelB} | ${cmp.ruleInfoB.industry} | ${cmp.ruleInfoB.version} | ${cmp.ruleInfoB.description} |`);
    lines.push('');

    lines.push('## 维度评分变化');
    lines.push('');
    lines.push('| 维度 | ' + cmp.labelA + ' | ' + cmp.labelB + ' | 变化 | 状态 |');
    lines.push('| :--- | :---: | :---: | :---: | :--- |');
    for (const d of cmp.dimensionDeltas) {
      const status = d.scoreDiff > 0 ? '📈 提升' : d.scoreDiff < 0 ? '📉 下降' : '➖ 不变';
      lines.push(`| ${d.dimension} | ${d.scoreA} | ${d.scoreB} | ${d.scoreDiff > 0 ? '+' : ''}${d.scoreDiff} | ${status} |`);
    }
    lines.push('');

    lines.push('## 风险变化详情');
    lines.push('');
    if (cmp.newRisks.length > 0) {
      lines.push(`### ➕ 新增风险 (${cmp.newRisks.length} 项)`);
      lines.push('');
      lines.push('| 风险 ID | 描述 | 级别 |');
      lines.push('| :--- | :--- | :--- |');
      for (const r of cmp.newRisks.slice(0, 10)) {
        lines.push(`| ${r.riskId} | ${r.message} | ${this.getRiskLevelLabel(r.levelB!)} |`);
      }
      lines.push('');
    }
    if (cmp.resolvedRisks.length > 0) {
      lines.push(`### ✅ 已解决风险 (${cmp.resolvedRisks.length} 项)`);
      lines.push('');
      lines.push('| 风险 ID | 描述 | 原级别 |');
      lines.push('| :--- | :--- | :--- |');
      for (const r of cmp.resolvedRisks.slice(0, 10)) {
        lines.push(`| ${r.riskId} | ${r.message} | ${this.getRiskLevelLabel(r.levelA!)} |`);
      }
      lines.push('');
    }
    if (cmp.levelIncreasedRisks.length > 0) {
      lines.push(`### ⚡ 风险等级上升 (${cmp.levelIncreasedRisks.length} 项)`);
      lines.push('');
      for (const r of cmp.levelIncreasedRisks.slice(0, 5)) {
        lines.push(`- **${r.message}**: ${this.getRiskLevelLabel(r.levelA!)} → ${this.getRiskLevelLabel(r.levelB!)}`);
      }
      lines.push('');
    }
    if (cmp.levelDecreasedRisks.length > 0) {
      lines.push(`### 📉 风险等级下降 (${cmp.levelDecreasedRisks.length} 项)`);
      lines.push('');
      for (const r of cmp.levelDecreasedRisks.slice(0, 5)) {
        lines.push(`- **${r.message}**: ${this.getRiskLevelLabel(r.levelA!)} → ${this.getRiskLevelLabel(r.levelB!)}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*对比报告结束*');
    return lines.join('\n');
  }

  generateBatchSummaryReport(
    batchResult: BatchScoringResult,
    options: { format?: 'text' | 'markdown'; includeGroups?: boolean } = {}
  ): string {
    const { format = 'text', includeGroups = true } = options;
    return format === 'markdown'
      ? this.formatBatchSummaryMarkdown(batchResult, includeGroups)
      : this.formatBatchSummaryPlain(batchResult, includeGroups);
  }

  private formatBatchSummaryPlain(batchResult: BatchScoringResult, includeGroups: boolean): string {
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
      lines.push('--- 🔥 高频风险 TOP 10 ---');
      for (const risk of batchResult.summary.highFrequencyRisks) {
        const pct = Math.round(risk.occurrencePercentage * 100) / 100;
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
      lines.push('  ✅ 暂无高频风险项');
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

    if (includeGroups) {
      if (batchResult.summary.groupByIndustry && batchResult.summary.groupByIndustry.length > 1) {
        lines.push('--- 🏢 按行业分组汇总 ---');
        for (const group of batchResult.summary.groupByIndustry) {
          const avgPct = Math.round(group.averageScore * 100) / 100;
          lines.push(`  ${group.groupName} (${group.totalItems} 个产品): 平均分 ${avgPct}%`);
          lines.push(`     风险Top1: ${group.highFrequencyRisks[0]?.message || '无'}`);
        }
        lines.push('');
      }

      if (batchResult.summary.groupByGrade && batchResult.summary.groupByGrade.length > 1) {
        lines.push('--- 🏅 按等级分组汇总 ---');
        for (const group of batchResult.summary.groupByGrade) {
          lines.push(`  ${group.groupName} (${group.totalItems} 个产品): 平均分 ${Math.round(group.averageScore * 100) / 100}%`);
        }
        lines.push('');
      }
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

  private formatBatchSummaryMarkdown(batchResult: BatchScoringResult, includeGroups: boolean): string {
    const lines: string[] = [];

    lines.push('# 批量数据要素质量评分汇总报告');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 整体概览');
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 📊 评分产品总数 | ${batchResult.summary.totalItems} |`);
    lines.push(`| 📈 平均得分率 | ${safePercentage(batchResult.summary.averageScore * 100, 100)}% |`);
    lines.push('');

    lines.push('## 等级分布');
    lines.push('');
    lines.push('| 等级 | 数量 | 占比 | 分布 |');
    lines.push('| :---: | :---: | :--- | :--- |');
    const grades: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];
    for (const grade of grades) {
      const count = batchResult.summary.gradeDistribution[grade] || 0;
      const pct = batchResult.summary.totalItems > 0
        ? safePercentage(count, batchResult.summary.totalItems)
        : 0;
      const bar = '█'.repeat(Math.round(pct / 5));
      lines.push(`| ${this.getGradeEmoji(grade)} ${grade} | ${count} | ${pct}% | ${bar} |`);
    }
    lines.push('');

    if (batchResult.summary.highFrequencyRisks.length > 0) {
      lines.push('## 🔥 高频风险 TOP 10');
      lines.push('');
      lines.push('| 级别 | 风险描述 | 出现次数 | 占比 | 影响产品 |');
      lines.push('| :---: | :--- | :---: | :---: | :--- |');
      for (const risk of batchResult.summary.highFrequencyRisks) {
        const pct = Math.round(risk.occurrencePercentage * 100) / 100;
        const products = risk.affectedProducts.length <= 5
          ? risk.affectedProducts.join(', ')
          : `${risk.affectedProducts.slice(0, 5).join(', ')} 等 ${risk.affectedProducts.length} 个`;
        lines.push(`| ${this.getRiskLevelLabel(risk.level)} | ${risk.message} | ${risk.occurrenceCount} | ${pct}% | ${products} |`);
      }
      lines.push('');
    }

    if (batchResult.summary.lowScoringDimensions.length > 0) {
      lines.push('## ⚠️ 低分维度分析 (< 60%)');
      lines.push('');
      lines.push('| 维度 | 平均分 | 低于60分产品数 | 占比 |');
      lines.push('| :--- | :---: | :---: | :---: |');
      for (const dim of batchResult.summary.lowScoringDimensions) {
        const pct = batchResult.summary.totalItems > 0
          ? safePercentage(dim.belowThresholdCount, batchResult.summary.totalItems)
          : 0;
        lines.push(`| ${dim.dimension} | ${dim.averageScore}% | ${dim.belowThresholdCount}/${batchResult.summary.totalItems} | ${pct}% |`);
      }
      lines.push('');
    }

    if (includeGroups) {
      if (batchResult.summary.groupByIndustry && batchResult.summary.groupByIndustry.length > 1) {
        lines.push('## 🏢 按行业分组汇总');
        lines.push('');
        lines.push('| 行业 | 产品数 | 平均分 |');
        lines.push('| :--- | :---: | :---: |');
        for (const group of batchResult.summary.groupByIndustry) {
          lines.push(`| ${group.groupName} | ${group.totalItems} | ${Math.round(group.averageScore * 100) / 100}% |`);
        }
        lines.push('');
      }

      if (batchResult.summary.groupByGrade && batchResult.summary.groupByGrade.length > 1) {
        lines.push('## 🏅 按等级分组汇总');
        lines.push('');
        lines.push('| 等级 | 产品数 | 平均分 |');
        lines.push('| :---: | :---: | :---: |');
        for (const group of batchResult.summary.groupByGrade) {
          lines.push(`| ${group.groupName} | ${group.totalItems} | ${Math.round(group.averageScore * 100) / 100}% |`);
        }
        lines.push('');
      }
    }

    lines.push('## 各产品评分概览');
    lines.push('');
    lines.push('| 产品ID | 等级 | 得分 | 风险项 | 状态 |');
    lines.push('| :--- | :---: | :---: | :---: | :--- |');
    for (const result of batchResult.results) {
      const pct = safePercentage(result.totalScore, result.maxScore);
      const indicator = result.grade === 'S' || result.grade === 'A' ? '✅ 通过' : result.grade === 'B' ? '👍 良好' : result.grade === 'C' ? '⚠️ 一般' : '❌ 较差';
      lines.push(`| ${result.productId} | ${this.getGradeEmoji(result.grade)} ${result.grade} | ${result.totalScore}/${result.maxScore} (${pct}%) | ${result.risks.length} | ${indicator} |`);
    }
    lines.push('');

    lines.push('---');
    lines.push('*批量报告结束*');
    return lines.join('\n');
  }

  generateImpactAnalysisReport(
    analysis: RuleImpactAnalysisResult,
    options: { format?: 'text' | 'markdown' } = {}
  ): string {
    const format = options.format || 'text';
    return format === 'markdown'
      ? this.formatImpactAnalysisMarkdown(analysis)
      : this.formatImpactAnalysisPlain(analysis);
  }

  generateMultiComparisonReport(
    comparison: MultiScoringComparisonResult,
    options: { format?: 'text' | 'markdown' } = {}
  ): string {
    const format = options.format || 'text';
    return format === 'markdown'
      ? this.formatMultiComparisonMarkdown(comparison)
      : this.formatMultiComparisonPlain(comparison);
  }

  generateAuditDeliveryPackage(
    batchResult: BatchScoringResult,
    options?: {
      applicationId?: string;
      format?: 'text' | 'markdown';
      passThreshold?: number;
      baselineResults?: ScoringResult[];
      baselineLabel?: string;
      targetLabel?: string;
    }
  ): AuditDeliveryPackage {
    const format = options?.format || 'text';
    const passThreshold = options?.passThreshold ?? DEFAULT_AUDIT_PASS_THRESHOLD;

    const productReports = batchResult.results.map((result) => ({
      productId: result.productId,
      productName: result.productId,
      auditReport: this.generateAuditSummaryReport(result, { passThreshold }),
    }));

    const passCount = productReports.filter((p) => p.auditReport.overallResult === 'PASS').length;
    const failCount = productReports.filter((p) => p.auditReport.overallResult === 'FAIL').length;
    const warningCount = productReports.filter((p) => p.auditReport.overallResult === 'WARNING').length;

    const rectificationList = productReports
      .filter((p) => p.auditReport.overallResult !== 'PASS')
      .map((p) => {
        const topPriority = p.auditReport.criticalFailures.length > 0 ? 'critical' :
          p.auditReport.highPriorityRisks.length > 0 ? 'high' : 'medium';
        return {
          productId: p.productId,
          productName: p.productName,
          priority: topPriority as 'critical' | 'high' | 'medium' | 'low',
          issues: [...p.auditReport.criticalFailures, ...p.auditReport.highPriorityRisks],
          suggestions: p.auditReport.rectificationPlan.map((plan) => plan.action),
        };
      });

    let comparisonConclusion: AuditDeliveryPackage['comparisonConclusion'] | undefined;
    if (options?.baselineResults && options.baselineResults.length > 0) {
      const baseline = options.baselineResults;
      const target = batchResult.results;
      let improved = 0;
      let declined = 0;
      const gradeOrder: QualityGrade[] = ['S', 'A', 'B', 'C', 'D'];

      for (let i = 0; i < Math.min(baseline.length, target.length); i++) {
        const baseGradeIdx = gradeOrder.indexOf(baseline[i].grade);
        const targetGradeIdx = gradeOrder.indexOf(target[i].grade);
        if (targetGradeIdx < baseGradeIdx) improved++;
        else if (targetGradeIdx > baseGradeIdx) declined++;
      }

      const baseScore = baseline.reduce((sum, r) => sum + safePercentage(r.totalScore, r.maxScore), 0) / baseline.length;
      const targetScore = target.reduce((sum, r) => sum + safePercentage(r.totalScore, r.maxScore), 0) / target.length;

      comparisonConclusion = {
        hasComparison: true,
        baselineLabel: options.baselineLabel || '基线版本',
        targetLabel: options.targetLabel || '当前版本',
        overallImprovement: Math.round((targetScore - baseScore) * 100) / 100,
        gradeImprovedCount: improved,
        gradeDeclinedCount: declined,
        keyFindings: [
          `整体平均分变化: ${baseScore.toFixed(2)}% → ${targetScore.toFixed(2)}%`,
          `等级提升产品数: ${improved} 个`,
          `等级下降产品数: ${declined} 个`,
        ],
      };
    }

    const firstResult = batchResult.results[0];
    const registry = IndustryRuleRegistry.getInstance();
    const industry = firstResult?.metadata.industry || 'general';
    const version = firstResult?.metadata.industryConfigVersion || 'default';
    const statusHistory = registry.getStatusHistory(industry, version);
    const lastStatusChange = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : undefined;

    const ruleInfo: AuditDeliveryPackage['ruleInfo'] = {
      industry: firstResult?.metadata.industry || 'general',
      version: firstResult?.metadata.industryConfigVersion || 'default',
      description: firstResult?.metadata.industryConfigDescription || '默认规则',
      status: (firstResult?.metadata.industryConfigStatus as RuleStatus) || 'published',
      source: (firstResult?.metadata.industryConfigSource as any) || 'built-in',
      isOverridden: firstResult?.metadata.industryConfigIsOverridden || false,
      isDefault: firstResult?.metadata.industryConfigIsDefault || false,
      registeredAt: firstResult?.metadata.industryConfigRegisteredAt || new Date().toISOString(),
      effectiveAt: firstResult?.metadata.industryConfigEffectiveAt,
      publishedAt: firstResult?.metadata.industryConfigPublishedAt,
      trialStartAt: firstResult?.metadata.industryConfigTrialStartAt,
      trialEndAt: firstResult?.metadata.industryConfigTrialEndAt,
      deprecatedAt: firstResult?.metadata.industryConfigDeprecatedAt,
      changeLog: firstResult?.metadata.industryConfigChangeLog,
      fallbackInfo: firstResult?.metadata.ruleFallbackInfo,
      lastStatusChange,
    };

    return {
      packageId: `audit-pkg-${Date.now()}`,
      applicationId: options?.applicationId,
      createdAt: new Date().toISOString(),
      summary: {
        totalProducts: batchResult.results.length,
        passCount,
        failCount,
        warningCount,
        overallPassRate: batchResult.results.length > 0
          ? Math.round((passCount / batchResult.results.length) * 10000) / 100
          : 0,
      },
      productReports,
      batchSummary: batchResult.summary,
      rectificationList,
      comparisonConclusion,
      ruleInfo,
    };
  }

  generateAuditDeliveryPackageText(
    batchResult: BatchScoringResult,
    options?: {
      applicationId?: string;
      format?: 'text' | 'markdown';
      passThreshold?: number;
      baselineResults?: ScoringResult[];
      baselineLabel?: string;
      targetLabel?: string;
    }
  ): string {
    const pkg = this.generateAuditDeliveryPackage(batchResult, options);
    const format = options?.format || 'text';
    return format === 'markdown'
      ? this.formatAuditDeliveryPackageMarkdown(pkg)
      : this.formatAuditDeliveryPackagePlain(pkg);
  }

  private formatAuditDeliveryPackagePlain(pkg: AuditDeliveryPackage): string {
    const lines: string[] = [];
    lines.push('========================================');
    lines.push('      数据产品上架审核材料包');
    lines.push('========================================');
    lines.push('');
    lines.push(`材料包编号: ${pkg.packageId}`);
    if (pkg.applicationId) lines.push(`上架申请号: ${pkg.applicationId}`);
    lines.push(`生成时间: ${pkg.createdAt}`);
    lines.push(`规则版本: ${pkg.ruleInfo.industry} / ${pkg.ruleInfo.version}`);
    lines.push(`规则状态: ${this.getRuleStatusLabel(pkg.ruleInfo.status)}`);
    lines.push('');

    lines.push('【一、审核汇总】');
    lines.push(`  总产品数: ${pkg.summary.totalProducts} 个`);
    lines.push(`  通过: ${pkg.summary.passCount} 个`);
    lines.push(`  不通过: ${pkg.summary.failCount} 个`);
    lines.push(`  需关注: ${pkg.summary.warningCount} 个`);
    lines.push(`  整体通过率: ${pkg.summary.overallPassRate}%`);
    lines.push('');

    lines.push('【二、批量汇总分析】');
    lines.push(`  平均分: ${pkg.batchSummary.averageScore.toFixed(2)}%`);
    lines.push(`  等级分布:`);
    for (const grade of ['S', 'A', 'B', 'C', 'D'] as QualityGrade[]) {
      const count = pkg.batchSummary.gradeDistribution[grade];
      if (count > 0) lines.push(`    ${grade}: ${count} 个`);
    }
    lines.push('');

    if (pkg.batchSummary.highFrequencyRisks.length > 0) {
      lines.push('  高频风险 TOP 5:');
      for (const r of pkg.batchSummary.highFrequencyRisks.slice(0, 5)) {
        lines.push(`    [${this.getRiskLevelLabel(r.level)}] ${r.message} (${r.occurrencePercentage}%)`);
      }
      lines.push('');
    }

    if (pkg.batchSummary.groupByCategory && pkg.batchSummary.groupByCategory.length > 0) {
      lines.push('  按风险类别汇总:');
      for (const g of pkg.batchSummary.groupByCategory) {
        lines.push(`    ${g.groupName}: ${g.totalItems} 个产品`);
      }
      lines.push('');
    }

    lines.push('【三、各产品审核摘要】');
    for (let i = 0; i < pkg.productReports.length; i++) {
      const pr = pkg.productReports[i];
      lines.push(`  ${i + 1}. ${pr.productId} ${pr.productName ? `(${pr.productName})` : ''}`);
      lines.push(`     结果: ${pr.auditReport.overallResult} | 得分: ${pr.auditReport.totalScore}分 | 等级: ${pr.auditReport.grade}`);
      if (pr.auditReport.criticalFailures.length > 0) {
        lines.push(`     致命问题: ${pr.auditReport.criticalFailures.length} 项`);
      }
      if (pr.auditReport.highPriorityRisks.length > 0) {
        lines.push(`     高优先级风险: ${pr.auditReport.highPriorityRisks.length} 项`);
      }
    }
    lines.push('');

    if (pkg.rectificationList.length > 0) {
      lines.push('【四、整改清单】');
      for (let i = 0; i < pkg.rectificationList.length; i++) {
        const rect = pkg.rectificationList[i];
        lines.push(`  ${i + 1}. ${rect.productId} [优先级: ${rect.priority.toUpperCase()}]`);
        lines.push(`     问题数: ${rect.issues.length} 个`);
        if (rect.suggestions.length > 0) {
          lines.push(`     整改建议:`);
          for (const s of rect.suggestions.slice(0, 3)) {
            lines.push(`       - ${s}`);
          }
        }
      }
      lines.push('');
    }

    if (pkg.comparisonConclusion && pkg.comparisonConclusion.hasComparison) {
      lines.push('【五、对比结论】');
      lines.push(`  基线: ${pkg.comparisonConclusion.baselineLabel} → 目标: ${pkg.comparisonConclusion.targetLabel}`);
      lines.push(`  整体平均分变化: ${pkg.comparisonConclusion.overallImprovement > 0 ? '+' : ''}${pkg.comparisonConclusion.overallImprovement}%`);
      lines.push(`  等级提升: ${pkg.comparisonConclusion.gradeImprovedCount} 个 | 等级下降: ${pkg.comparisonConclusion.gradeDeclinedCount} 个`);
      lines.push('');
    }

    lines.push('【六、规则信息】');
    lines.push(`  行业: ${pkg.ruleInfo.industry}`);
    lines.push(`  版本: ${pkg.ruleInfo.version}`);
    lines.push(`  说明: ${pkg.ruleInfo.description}`);
    lines.push(`  状态: ${this.getRuleStatusLabel(pkg.ruleInfo.status)}`);
    lines.push(`  来源: ${pkg.ruleInfo.source}`);
    if (pkg.ruleInfo.isDefault) lines.push(`  是否默认版本: 是`);
    if (pkg.ruleInfo.isOverridden) lines.push(`  是否被覆盖: 是（使用自定义覆盖配置）`);
    if (pkg.ruleInfo.registeredAt) lines.push(`  注册时间: ${pkg.ruleInfo.registeredAt}`);
    if (pkg.ruleInfo.publishedAt) lines.push(`  发布时间: ${pkg.ruleInfo.publishedAt}`);
    if (pkg.ruleInfo.effectiveAt) lines.push(`  生效时间: ${pkg.ruleInfo.effectiveAt}`);
    if (pkg.ruleInfo.trialStartAt) lines.push(`  试运行开始: ${pkg.ruleInfo.trialStartAt}`);
    if (pkg.ruleInfo.trialEndAt) lines.push(`  试运行结束: ${pkg.ruleInfo.trialEndAt}`);
    if (pkg.ruleInfo.deprecatedAt) lines.push(`  停用时间: ${pkg.ruleInfo.deprecatedAt}`);
    if (pkg.ruleInfo.changeLog) lines.push(`  变更说明: ${pkg.ruleInfo.changeLog}`);
    if (pkg.ruleInfo.lastStatusChange) {
      lines.push(`  最近状态变更: ${this.formatStatusTransition(pkg.ruleInfo.lastStatusChange.fromStatus, pkg.ruleInfo.lastStatusChange.toStatus)}`);
      lines.push(`    变更时间: ${pkg.ruleInfo.lastStatusChange.changedAt}`);
      if (pkg.ruleInfo.lastStatusChange.remark) {
        lines.push(`    变更备注: ${pkg.ruleInfo.lastStatusChange.remark}`);
      }
    }
    if (pkg.ruleInfo.fallbackInfo) {
      lines.push('');
      lines.push('  ⚠️  规则回退说明:');
      lines.push(`    请求版本: ${pkg.ruleInfo.fallbackInfo.requestedIndustry || pkg.ruleInfo.industry} / ${pkg.ruleInfo.fallbackInfo.requestedVersion || 'default'}`);
      lines.push(`    实际使用: ${pkg.ruleInfo.fallbackInfo.fallbackIndustry} / ${pkg.ruleInfo.fallbackInfo.fallbackVersion}`);
      lines.push(`    回退原因: ${pkg.ruleInfo.fallbackInfo.reason}`);
    }
    lines.push('');
    lines.push('========================================');
    lines.push('        材料包生成完毕');
    lines.push('========================================');

    return lines.join('\n');
  }

  private formatAuditDeliveryPackageMarkdown(pkg: AuditDeliveryPackage): string {
    const lines: string[] = [];
    lines.push('# 数据产品上架审核材料包');
    lines.push('');
    lines.push(`> 材料包编号：\`${pkg.packageId}\``);
    if (pkg.applicationId) lines.push(`> 上架申请号：\`${pkg.applicationId}\``);
    lines.push(`> 生成时间：${pkg.createdAt}`);
    lines.push(`> 规则版本：${pkg.ruleInfo.industry} / ${pkg.ruleInfo.version} (${this.getRuleStatusLabel(pkg.ruleInfo.status)})`);
    lines.push('');

    lines.push('## 一、审核汇总');
    lines.push('');
    lines.push('| 指标 | 数量 |');
    lines.push('| :--- | ---: |');
    lines.push(`| 总产品数 | ${pkg.summary.totalProducts} 个 |`);
    lines.push(`| ✅ 通过 | ${pkg.summary.passCount} 个 |`);
    lines.push(`| ❌ 不通过 | ${pkg.summary.failCount} 个 |`);
    lines.push(`| ⚠️  需关注 | ${pkg.summary.warningCount} 个 |`);
    lines.push(`| 整体通过率 | **${pkg.summary.overallPassRate}%** |`);
    lines.push('');

    lines.push('## 二、批量汇总分析');
    lines.push('');
    lines.push(`### 2.1 等级分布`);
    lines.push('');
    lines.push('| 等级 | 数量 | 占比 |');
    lines.push('| :--- | ---: | ---: |');
    for (const grade of ['S', 'A', 'B', 'C', 'D'] as QualityGrade[]) {
      const count = pkg.batchSummary.gradeDistribution[grade];
      const pct = pkg.summary.totalProducts > 0 ? ((count / pkg.summary.totalProducts) * 100).toFixed(1) : '0.0';
      lines.push(`| ${this.getGradeEmoji(grade)} ${grade} | ${count} 个 | ${pct}% |`);
    }
    lines.push('');

    if (pkg.batchSummary.highFrequencyRisks.length > 0) {
      lines.push('### 2.2 高频风险 TOP 10');
      lines.push('');
      lines.push('| 级别 | 风险描述 | 出现次数 | 占比 |');
      lines.push('| :--- | :--- | ---: | ---: |');
      for (const r of pkg.batchSummary.highFrequencyRisks) {
        lines.push(`| ${this.getRiskLevelLabel(r.level)} | ${r.message} | ${r.occurrenceCount} | ${r.occurrencePercentage}% |`);
      }
      lines.push('');
    }

    if (pkg.batchSummary.groupByCategory && pkg.batchSummary.groupByCategory.length > 0) {
      lines.push('### 2.3 按风险类别汇总');
      lines.push('');
      lines.push('| 风险类别 | 影响产品数 | 平均分 |');
      lines.push('| :--- | ---: | ---: |');
      for (const g of pkg.batchSummary.groupByCategory) {
        lines.push(`| ${g.groupName} | ${g.totalItems} 个 | ${g.averageScore}% |`);
      }
      lines.push('');
    }

    if (pkg.batchSummary.groupByIndustry && pkg.batchSummary.groupByIndustry.length > 0) {
      lines.push('### 2.4 按行业分组汇总');
      lines.push('');
      lines.push('| 行业 | 产品数 | 平均分 | 等级分布 |');
      lines.push('| :--- | ---: | ---: | :--- |');
      for (const g of pkg.batchSummary.groupByIndustry) {
        const dist = `S${g.gradeDistribution.S} A${g.gradeDistribution.A} B${g.gradeDistribution.B} C${g.gradeDistribution.C} D${g.gradeDistribution.D}`;
        lines.push(`| ${g.groupName} | ${g.totalItems} | ${g.averageScore}% | ${dist} |`);
      }
      lines.push('');
    }

    lines.push('## 三、各产品审核摘要');
    lines.push('');
    for (let i = 0; i < pkg.productReports.length; i++) {
      const pr = pkg.productReports[i];
      const resultEmoji = pr.auditReport.overallResult === 'PASS' ? '✅' :
        pr.auditReport.overallResult === 'FAIL' ? '❌' : '⚠️';
      lines.push(`### ${i + 1}. ${pr.productId} ${pr.productName ? `(${pr.productName})` : ''}`);
      lines.push('');
      lines.push(`- **审核结果**：${resultEmoji} ${pr.auditReport.overallResult}`);
      lines.push(`- **综合得分**：${pr.auditReport.totalScore} / ${pr.auditReport.maxScore} 分`);
      lines.push(`- **质量等级**：${this.getGradeEmoji(pr.auditReport.grade)} ${pr.auditReport.grade}`);
      if (pr.auditReport.criticalFailures.length > 0) {
        lines.push(`- **致命问题**：${pr.auditReport.criticalFailures.length} 项`);
      }
      if (pr.auditReport.highPriorityRisks.length > 0) {
        lines.push(`- **高优先级风险**：${pr.auditReport.highPriorityRisks.length} 项`);
      }
      lines.push('');
    }

    if (pkg.rectificationList.length > 0) {
      lines.push('## 四、整改清单');
      lines.push('');
      lines.push('| 序号 | 产品ID | 优先级 | 问题数 | 核心整改建议 |');
      lines.push('| ---: | :--- | :---: | ---: | :--- |');
      for (let i = 0; i < pkg.rectificationList.length; i++) {
        const rect = pkg.rectificationList[i];
        const topSuggestion = rect.suggestions[0] || '详见详细报告';
        lines.push(`| ${i + 1} | ${rect.productId} | **${rect.priority.toUpperCase()}** | ${rect.issues.length} | ${topSuggestion} |`);
      }
      lines.push('');
    }

    if (pkg.comparisonConclusion && pkg.comparisonConclusion.hasComparison) {
      lines.push('## 五、对比结论');
      lines.push('');
      lines.push(`> 对比基准：**${pkg.comparisonConclusion.baselineLabel}** → **${pkg.comparisonConclusion.targetLabel}**`);
      lines.push('');
      lines.push('| 指标 | 数值 |');
      lines.push('| :--- | ---: |');
      lines.push(`| 整体平均分变化 | ${pkg.comparisonConclusion.overallImprovement > 0 ? '+' : ''}${pkg.comparisonConclusion.overallImprovement}% |`);
      lines.push(`| 等级提升产品数 | ${pkg.comparisonConclusion.gradeImprovedCount} 个 |`);
      lines.push(`| 等级下降产品数 | ${pkg.comparisonConclusion.gradeDeclinedCount} 个 |`);
      lines.push('');
      lines.push('### 关键发现');
      lines.push('');
      for (const finding of pkg.comparisonConclusion.keyFindings) {
        lines.push(`- ${finding}`);
      }
      lines.push('');
    }

    lines.push('## 六、规则信息');
    lines.push('');
    lines.push('| 项目 | 内容 |');
    lines.push('| :--- | :--- |');
    lines.push(`| 适用行业 | ${pkg.ruleInfo.industry} |`);
    lines.push(`| 规则版本 | ${pkg.ruleInfo.version} |`);
    lines.push(`| 规则说明 | ${pkg.ruleInfo.description} |`);
    lines.push(`| 规则状态 | ${this.getRuleStatusLabel(pkg.ruleInfo.status)} |`);
    lines.push(`| 规则来源 | ${pkg.ruleInfo.source} |`);
    if (pkg.ruleInfo.isDefault) lines.push(`| 是否默认版本 | ✅ 是 |`);
    if (pkg.ruleInfo.isOverridden) lines.push(`| 是否被覆盖 | ✅ 是（使用自定义覆盖配置） |`);
    if (pkg.ruleInfo.registeredAt) lines.push(`| 注册时间 | ${pkg.ruleInfo.registeredAt} |`);
    if (pkg.ruleInfo.publishedAt) lines.push(`| 发布时间 | ${pkg.ruleInfo.publishedAt} |`);
    if (pkg.ruleInfo.effectiveAt) lines.push(`| 生效时间 | ${pkg.ruleInfo.effectiveAt} |`);
    if (pkg.ruleInfo.trialStartAt) lines.push(`| 试运行开始 | ${pkg.ruleInfo.trialStartAt} |`);
    if (pkg.ruleInfo.trialEndAt) lines.push(`| 试运行结束 | ${pkg.ruleInfo.trialEndAt} |`);
    if (pkg.ruleInfo.deprecatedAt) lines.push(`| 停用时间 | ${pkg.ruleInfo.deprecatedAt} |`);
    if (pkg.ruleInfo.changeLog) lines.push(`| 变更说明 | ${pkg.ruleInfo.changeLog} |`);
    lines.push('');

    if (pkg.ruleInfo.lastStatusChange) {
      lines.push('### 最近状态变更');
      lines.push('');
      lines.push('| 项目 | 内容 |');
      lines.push('| :--- | :--- |');
      lines.push(`| 状态变更 | ${this.formatStatusTransition(pkg.ruleInfo.lastStatusChange.fromStatus, pkg.ruleInfo.lastStatusChange.toStatus)} |`);
      lines.push(`| 变更时间 | ${pkg.ruleInfo.lastStatusChange.changedAt} |`);
      if (pkg.ruleInfo.lastStatusChange.remark) lines.push(`| 变更备注 | ${pkg.ruleInfo.lastStatusChange.remark} |`);
      lines.push('');
    }

    if (pkg.ruleInfo.fallbackInfo) {
      lines.push('> ⚠️ **规则回退说明**');
      lines.push('');
      lines.push('| 项目 | 内容 |');
      lines.push('| :--- | :--- |');
      lines.push(`| 请求版本 | ${pkg.ruleInfo.fallbackInfo.requestedIndustry || pkg.ruleInfo.industry} / ${pkg.ruleInfo.fallbackInfo.requestedVersion || 'default'} |`);
      lines.push(`| 实际使用 | ${pkg.ruleInfo.fallbackInfo.fallbackIndustry} / ${pkg.ruleInfo.fallbackInfo.fallbackVersion} |`);
      lines.push(`| 回退原因 | ${pkg.ruleInfo.fallbackInfo.reason} |`);
      lines.push('');
    }

    lines.push('---');
    lines.push('*本材料包由数据质量评分 SDK 自动生成*');

    return lines.join('\n');
  }

  private formatMultiComparisonPlain(cmp: MultiScoringComparisonResult): string {
    const lines: string[] = [];
    lines.push('========================================');
    lines.push('     多方案评分对比报告');
    lines.push('========================================');
    lines.push('');
    lines.push(`产品ID: ${cmp.productId}`);
    lines.push(`生成时间: ${cmp.scoredAt}`);
    lines.push('');

    lines.push('【最佳方案】');
    lines.push(`  ${cmp.bestScenario.label}: ${cmp.bestScenario.totalScorePercent}% (${cmp.bestScenario.grade})`);
    lines.push(`  理由: ${cmp.bestScenario.reason}`);
    lines.push('');

    lines.push('【方案排名】');
    for (let i = 0; i < cmp.scenarios.length; i++) {
      const s = cmp.scenarios[i];
      lines.push(`  ${i + 1}. ${s.label} — 得分: ${s.totalScorePercent}%, 等级: ${s.grade}`);
    }
    lines.push('');

    lines.push('【维度对比】');
    for (const dim of cmp.dimensionComparison) {
      lines.push(`  ${dim.dimensionName}:`);
      lines.push(`    最佳: ${dim.bestLabel} (${dim.scores[dim.bestLabel]}%)`);
      lines.push(`    最差: ${dim.worstLabel} (${dim.scores[dim.worstLabel]}%)`);
      lines.push(`    最大差值: ${dim.maxDiff}%`);
    }
    lines.push('');

    lines.push('【风险对比】');
    lines.push(`  各方案风险总数:`);
    for (const label of Object.keys(cmp.riskComparison.totalRiskCounts)) {
      const count = cmp.riskComparison.totalRiskCounts[label];
      const criticalCount = cmp.riskComparison.criticalRiskCounts[label] || 0;
      lines.push(`    ${label}: ${count} 项 (严重+高危 ${criticalCount} 项)`);
    }
    lines.push('');

    return lines.join('\n');
  }

  private formatMultiComparisonMarkdown(cmp: MultiScoringComparisonResult): string {
    const lines: string[] = [];
    lines.push('# 多方案评分对比报告');
    lines.push('');
    lines.push(`> 产品ID：\`${cmp.productId}\``);
    lines.push(`> 生成时间：${cmp.scoredAt}`);
    lines.push('');

    lines.push('## 🏆 最佳方案');
    lines.push('');
    lines.push(`**${cmp.bestScenario.label}** — ${cmp.bestScenario.totalScorePercent}% · ${cmp.bestScenario.grade}级`);
    lines.push('');
    lines.push(`> ${cmp.bestScenario.reason}`);
    lines.push('');

    lines.push('## 📊 方案排名');
    lines.push('');
    lines.push('| 排名 | 方案 | 总分 | 等级 |');
    lines.push('| ---: | :--- | ---: | :---: |');
    for (let i = 0; i < cmp.scenarios.length; i++) {
      const s = cmp.scenarios[i];
      lines.push(`| ${i + 1} | ${s.label} | ${s.totalScorePercent}% | ${this.getGradeEmoji(s.grade)} ${s.grade} |`);
    }
    lines.push('');

    lines.push('## 📈 各维度得分对比');
    lines.push('');
    const headers = ['维度', ...cmp.scenarios.map((s) => s.label), '最佳', '最大差值'];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('| :--- |' + cmp.scenarios.map(() => ' ---: |').join('') + ' :--- | ---: |');
    for (const dim of cmp.dimensionComparison) {
      const scores = cmp.scenarios.map((s) => `${dim.scores[s.label]}%`).join(' | ');
      lines.push(`| ${dim.dimensionName} | ${scores} | ${dim.bestLabel} | ${dim.maxDiff}% |`);
    }
    lines.push('');

    lines.push('## ⚠️  风险对比');
    lines.push('');
    lines.push('| 方案 | 总风险数 | 严重+高危 | 新增风险数 | 已解决风险数 |');
    lines.push('| :--- | ---: | ---: | ---: | ---: |');
    for (const s of cmp.scenarios) {
      const total = cmp.riskComparison.totalRiskCounts[s.label] || 0;
      const critical = cmp.riskComparison.criticalRiskCounts[s.label] || 0;
      const newRisks = cmp.riskComparison.newRisksPerScenario[s.label]?.length || 0;
      const resolved = cmp.riskComparison.resolvedRisksPerScenario[s.label]?.length || 0;
      lines.push(`| ${s.label} | ${total} | ${critical} | ${newRisks} | ${resolved} |`);
    }
    lines.push('');

    lines.push('## 📉 低分维度对比');
    lines.push('');
    for (const s of cmp.scenarios) {
      const lowDims = cmp.lowScoringDimensionsComparison[s.label] || [];
      lines.push(`### ${s.label}`);
      lines.push('');
      if (lowDims.length === 0) {
        lines.push('_无低分维度_');
      } else {
        lines.push('| 维度 | 得分 |');
        lines.push('| :--- | ---: |');
        for (const d of lowDims) {
          lines.push(`| ${d.dimension} | ${d.averageScore}% |`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatImpactAnalysisPlain(analysis: RuleImpactAnalysisResult): string {
    const lines: string[] = [];
    lines.push('========================================');
    lines.push('   规则变更影响分析报告');
    lines.push('========================================');
    lines.push('');
    lines.push(`分析ID: ${analysis.analysisId}`);
    lines.push(`行业: ${analysis.industry}`);
    lines.push(`基线版本: ${analysis.baselineVersion}`);
    lines.push(`目标版本: ${analysis.targetVersion}`);
    lines.push(`分析时间: ${analysis.analyzedAt}`);
    lines.push(`分析产品数: ${analysis.totalProducts} 个`);
    lines.push('');

    lines.push('【等级变化】');
    lines.push(`  提升: ${analysis.gradeChanges.improved} 个`);
    lines.push(`  下降: ${analysis.gradeChanges.declined} 个`);
    lines.push(`  不变: ${analysis.gradeChanges.unchanged} 个`);
    if (analysis.gradeChanges.declinedProducts.length > 0) {
      lines.push(`  下降产品: ${analysis.gradeChanges.declinedProducts.slice(0, 5).join(', ')}${analysis.gradeChanges.declinedProducts.length > 5 ? '...' : ''}`);
    }
    lines.push('');

    lines.push('【分数变化】');
    lines.push(`  平均分变化: ${analysis.scoreChanges.averageScoreChange > 0 ? '+' : ''}${analysis.scoreChanges.averageScoreChange}%`);
    lines.push(`  最大提升: +${analysis.scoreChanges.maxScoreIncrease}%`);
    lines.push(`  最大下降: ${analysis.scoreChanges.maxScoreDecrease}%`);
    lines.push('');

    if (analysis.newRisks.length > 0) {
      lines.push('【新增风险】');
      for (const r of analysis.newRisks.slice(0, 5)) {
        lines.push(`  [${this.getRiskLevelLabel(r.level)}] ${r.message} — ${r.occurrenceCount}/${analysis.totalProducts} (${r.occurrencePercentage}%)`);
      }
      lines.push('');
    }

    if (analysis.resolvedRisks.length > 0) {
      lines.push('【已解决风险】');
      for (const r of analysis.resolvedRisks.slice(0, 5)) {
        lines.push(`  [${this.getRiskLevelLabel(r.level)}] ${r.message} — ${r.occurrenceCount}/${analysis.totalProducts} (${r.occurrencePercentage}%)`);
      }
      lines.push('');
    }

    lines.push('【维度影响】');
    for (const dim of analysis.dimensionImpact) {
      const change = dim.averageScoreChange;
      lines.push(`  ${dim.dimensionName}: ${change > 0 ? '+' : ''}${change}% (改善 ${dim.productsImproved}个, 恶化 ${dim.productsWorsened}个)`);
    }
    lines.push('');

    if (analysis.recommendations.length > 0) {
      lines.push('【发布建议】');
      for (let i = 0; i < analysis.recommendations.length; i++) {
        lines.push(`  ${i + 1}. ${analysis.recommendations[i]}`);
      }
      lines.push('');
    }

    if (analysis.groupedSummary) {
      if (Object.keys(analysis.groupedSummary.byGradeDecline).length > 0) {
        lines.push('【按下降等级分组】');
        for (const [key, data] of Object.entries(analysis.groupedSummary.byGradeDecline)) {
          lines.push(`  ${key}: ${data.count} 个产品, 平均下降 ${data.averageScoreDrop}%`);
          lines.push(`    产品: ${data.products.slice(0, 5).join(', ')}${data.products.length > 5 ? '...' : ''}`);
        }
        lines.push('');
      }

      if (Object.keys(analysis.groupedSummary.byRiskCategory).length > 0) {
        lines.push('【按风险类别分组】');
        for (const [cat, data] of Object.entries(analysis.groupedSummary.byRiskCategory)) {
          lines.push(`  ${cat}: 影响 ${data.totalProducts} 个产品, 共 ${data.totalOccurrences} 次, 高优先级 ${data.highPriorityCount} 次`);
        }
        lines.push('');
      }

      if (Object.keys(analysis.groupedSummary.byIndustry).length > 0) {
        lines.push('【按行业分组】');
        for (const [ind, data] of Object.entries(analysis.groupedSummary.byIndustry)) {
          lines.push(`  ${ind}: ${data.total} 个产品, 下降 ${data.declined} 个, 新增风险 ${data.newRisks} 个, 平均分变化 ${data.averageScoreChange > 0 ? '+' : ''}${data.averageScoreChange}%`);
        }
        lines.push('');
      }
    }

    if (analysis.releaseRiskList && analysis.releaseRiskList.length > 0) {
      lines.push('【发布风险清单】');
      const criticalRisks = analysis.releaseRiskList.filter((r) => r.severity === 'critical');
      const highRisks = analysis.releaseRiskList.filter((r) => r.severity === 'high');
      const mediumRisks = analysis.releaseRiskList.filter((r) => r.severity === 'medium');

      lines.push(`  总风险项: ${analysis.releaseRiskList.length} 个`);
      lines.push(`  严重: ${criticalRisks.length} 个 | 高: ${highRisks.length} 个 | 中: ${mediumRisks.length} 个`);
      lines.push('');
      lines.push('  高优先级风险前10项:');
      for (let i = 0; i < Math.min(10, analysis.releaseRiskList.length); i++) {
        const r = analysis.releaseRiskList[i];
        lines.push(`  ${i + 1}. [${r.severity.toUpperCase()}] ${r.productId} - ${r.description}`);
        lines.push(`     类型: ${r.impactType}, 类别: ${r.riskCategory}`);
        lines.push(`     建议: ${r.recommendation}`);
      }
      lines.push('');
    }

    if (analysis.productDetails && analysis.productDetails.length > 0) {
      lines.push('【产品变化明细前5项】');
      for (let i = 0; i < Math.min(5, analysis.productDetails.length); i++) {
        const p = analysis.productDetails[i];
        const changeEmoji = p.gradeChange === 'improved' ? '⬆️' : p.gradeChange === 'declined' ? '⬇️' : '➡️';
        lines.push(`  ${i + 1}. ${p.productId} ${changeEmoji} ${p.baselineGrade}→${p.targetGrade} (${p.scoreChange > 0 ? '+' : ''}${p.scoreChange}%)`);
        if (p.newRisks.length > 0) {
          lines.push(`     新增风险: ${p.newRisks.slice(0, 3).map((r) => `[${r.level}]${r.message}`).join('; ')}`);
        }
        if (p.dimensionChanges.length > 0) {
          const majorChanges = p.dimensionChanges.filter((d) => Math.abs(d.scoreChange) >= 1);
          if (majorChanges.length > 0) {
            lines.push(`     维度变化: ${majorChanges.slice(0, 3).map((d) => `${d.dimensionName}:${d.scoreChange > 0 ? '+' : ''}${d.scoreChange}%`).join(', ')}`);
          }
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatImpactAnalysisMarkdown(analysis: RuleImpactAnalysisResult): string {
    const lines: string[] = [];
    lines.push('# 规则变更影响分析报告');
    lines.push('');
    lines.push(`> 分析ID：\`${analysis.analysisId}\``);
    lines.push(`> 行业：${analysis.industry}`);
    lines.push(`> 规则版本：${analysis.baselineVersion} → ${analysis.targetVersion}`);
    lines.push(`> 分析时间：${analysis.analyzedAt}`);
    lines.push(`> 分析产品数：${analysis.totalProducts} 个`);
    lines.push('');

    lines.push('## 📊 等级变化');
    lines.push('');
    lines.push('| 变化类型 | 产品数 | 占比 |');
    lines.push('| :--- | ---: | ---: |');
    const total = analysis.totalProducts;
    lines.push(`| ⬆️ 等级提升 | ${analysis.gradeChanges.improved} 个 | ${((analysis.gradeChanges.improved / total) * 100).toFixed(1)}% |`);
    lines.push(`| ⬇️ 等级下降 | ${analysis.gradeChanges.declined} 个 | ${((analysis.gradeChanges.declined / total) * 100).toFixed(1)}% |`);
    lines.push(`| ➡️ 等级不变 | ${analysis.gradeChanges.unchanged} 个 | ${((analysis.gradeChanges.unchanged / total) * 100).toFixed(1)}% |`);
    lines.push('');

    lines.push('## 📈 分数变化');
    lines.push('');
    lines.push('| 指标 | 数值 |');
    lines.push('| :--- | ---: |');
    lines.push(`| 平均分变化 | ${analysis.scoreChanges.averageScoreChange > 0 ? '+' : ''}${analysis.scoreChanges.averageScoreChange}% |`);
    lines.push(`| 最大提升 | +${analysis.scoreChanges.maxScoreIncrease}% |`);
    lines.push(`| 最大下降 | ${analysis.scoreChanges.maxScoreDecrease}% |`);
    lines.push('');

    if (analysis.newRisks.length > 0) {
      lines.push('## 🆕 新增风险');
      lines.push('');
      lines.push('| 级别 | 风险描述 | 影响产品数 | 占比 |');
      lines.push('| :--- | :--- | ---: | ---: |');
      for (const r of analysis.newRisks.slice(0, 10)) {
        lines.push(`| ${this.getRiskLevelLabel(r.level)} | ${r.message} | ${r.occurrenceCount} | ${r.occurrencePercentage}% |`);
      }
      lines.push('');
    }

    if (analysis.resolvedRisks.length > 0) {
      lines.push('## ✅ 已解决风险');
      lines.push('');
      lines.push('| 级别 | 风险描述 | 影响产品数 | 占比 |');
      lines.push('| :--- | :--- | ---: | ---: |');
      for (const r of analysis.resolvedRisks.slice(0, 10)) {
        lines.push(`| ${this.getRiskLevelLabel(r.level)} | ${r.message} | ${r.occurrenceCount} | ${r.occurrencePercentage}% |`);
      }
      lines.push('');
    }

    lines.push('## 📐 各维度影响');
    lines.push('');
    lines.push('| 维度 | 平均分变化 | 改善产品数 | 恶化产品数 |');
    lines.push('| :--- | ---: | ---: | ---: |');
    for (const dim of analysis.dimensionImpact) {
      const change = dim.averageScoreChange;
      lines.push(`| ${dim.dimensionName} | ${change > 0 ? '+' : ''}${change}% | ${dim.productsImproved} | ${dim.productsWorsened} |`);
    }
    lines.push('');

    if (analysis.riskCategoryImpact.length > 0) {
      lines.push('## 🏷️  风险类别影响');
      lines.push('');
      lines.push('| 风险类别 | 基线产品数 | 目标产品数 | 变化 |');
      lines.push('| :--- | ---: | ---: | ---: |');
      for (const cat of analysis.riskCategoryImpact) {
        const change = cat.change;
        lines.push(`| ${cat.category} | ${cat.baselineCount} | ${cat.targetCount} | ${change > 0 ? '+' : ''}${change} |`);
      }
      lines.push('');
    }

    if (analysis.recommendations.length > 0) {
      lines.push('## 💡 发布建议');
      lines.push('');
      for (let i = 0; i < analysis.recommendations.length; i++) {
        lines.push(`${i + 1}. ${analysis.recommendations[i]}`);
      }
      lines.push('');
    }

    if (analysis.groupedSummary) {
      if (Object.keys(analysis.groupedSummary.byGradeDecline).length > 0) {
        lines.push('## 📊 按下降等级分组');
        lines.push('');
        lines.push('| 等级变化 | 产品数 | 平均下降 | 产品列表 |');
        lines.push('| :--- | ---: | ---: | :--- |');
        for (const [key, data] of Object.entries(analysis.groupedSummary.byGradeDecline)) {
          const products = data.products.slice(0, 5).join(', ') + (data.products.length > 5 ? '...' : '');
          lines.push(`| ${key} | ${data.count} 个 | ${data.averageScoreDrop}% | ${products} |`);
        }
        lines.push('');
      }

      if (Object.keys(analysis.groupedSummary.byRiskCategory).length > 0) {
        lines.push('## 🏷️  按风险类别分组');
        lines.push('');
        lines.push('| 风险类别 | 影响产品数 | 总发生次数 | 高优先级次数 |');
        lines.push('| :--- | ---: | ---: | ---: |');
        for (const [cat, data] of Object.entries(analysis.groupedSummary.byRiskCategory)) {
          lines.push(`| ${cat} | ${data.totalProducts} | ${data.totalOccurrences} | ${data.highPriorityCount} |`);
        }
        lines.push('');
      }

      if (Object.keys(analysis.groupedSummary.byIndustry).length > 0) {
        lines.push('## 🏢 按行业分组');
        lines.push('');
        lines.push('| 行业 | 总产品数 | 等级下降 | 新增风险 | 平均分变化 |');
        lines.push('| :--- | ---: | ---: | ---: | ---: |');
        for (const [ind, data] of Object.entries(analysis.groupedSummary.byIndustry)) {
          lines.push(`| ${ind} | ${data.total} | ${data.declined} | ${data.newRisks} | ${data.averageScoreChange > 0 ? '+' : ''}${data.averageScoreChange}% |`);
        }
        lines.push('');
      }
    }

    if (analysis.releaseRiskList && analysis.releaseRiskList.length > 0) {
      lines.push('## ⚠️  发布风险清单');
      lines.push('');
      const criticalRisks = analysis.releaseRiskList.filter((r) => r.severity === 'critical');
      const highRisks = analysis.releaseRiskList.filter((r) => r.severity === 'high');
      const mediumRisks = analysis.releaseRiskList.filter((r) => r.severity === 'medium');

      lines.push(`> 总风险项：**${analysis.releaseRiskList.length}** 个 | 严重：${criticalRisks.length} | 高：${highRisks.length} | 中：${mediumRisks.length}`);
      lines.push('');

      lines.push('| 优先级 | 产品ID | 影响类型 | 风险描述 | 整改建议 |');
      lines.push('| :---: | :--- | :--- | :--- | :--- |');
      for (let i = 0; i < Math.min(20, analysis.releaseRiskList.length); i++) {
        const r = analysis.releaseRiskList[i];
        lines.push(`| ${this.getRiskLevelLabel(r.severity)} | ${r.productId} | ${r.impactType} | ${r.description} | ${r.recommendation} |`);
      }
      lines.push('');
    }

    if (analysis.productDetails && analysis.productDetails.length > 0) {
      lines.push('## 📋 产品变化明细');
      lines.push('');
      lines.push('| 序号 | 产品ID | 等级变化 | 分数变化 | 新增风险 |');
      lines.push('| ---: | :--- | :---: | ---: | :--- |');
      for (let i = 0; i < Math.min(10, analysis.productDetails.length); i++) {
        const p = analysis.productDetails[i];
        const changeEmoji = p.gradeChange === 'improved' ? '⬆️' : p.gradeChange === 'declined' ? '⬇️' : '➡️';
        const newRisksText = p.newRisks.length > 0
          ? p.newRisks.slice(0, 2).map((r) => `[${this.getRiskLevelLabel(r.level)}]${r.message}`).join('; ')
          : '-';
        lines.push(`| ${i + 1} | ${p.productId} | ${changeEmoji} ${p.baselineGrade}→${p.targetGrade} | ${p.scoreChange > 0 ? '+' : ''}${p.scoreChange}% | ${newRisksText} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private getRuleStatusLabel(status: RuleStatus): string {
    const labels: Record<RuleStatus, string> = {
      draft: '草稿',
      trial: '试运行',
      published: '已发布',
      deprecated: '已停用',
    };
    return labels[status] || status;
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

  private getRiskLevelLabel(level: RiskLevel | 'critical' | 'high' | 'medium' | 'low'): string {
    const labels: Record<string, string> = {
      critical: '严重',
      high: '高',
      medium: '中',
      low: '低',
    };
    return labels[level] || level;
  }

  generateRuleReviewViewReport(
    reviewView: any,
    options?: { format?: 'text' | 'markdown' }
  ): string {
    const format = options?.format || 'text';
    return format === 'markdown'
      ? this.formatRuleReviewViewMarkdown(reviewView)
      : this.formatRuleReviewViewPlain(reviewView);
  }

  private formatRuleReviewViewPlain(view: any): string {
    const lines: string[] = [];
    lines.push('========================================');
    lines.push('       规则评审视图');
    lines.push('========================================');
    lines.push('');
    lines.push(`评审ID: ${view.reviewId}`);
    lines.push(`生成时间: ${view.generatedAt}`);
    lines.push(`涉及行业: ${view.industries.join(', ')}`);
    lines.push('');

    lines.push('【汇总】');
    lines.push(`  总规则数: ${view.summary.totalRules}`);
    lines.push(`  草稿: ${view.summary.draftCount} | 试运行: ${view.summary.trialCount} | 已发布: ${view.summary.publishedCount} | 已停用: ${view.summary.deprecatedCount}`);
    lines.push(`  待评审: ${view.summary.pendingReviewCount}`);
    lines.push(`  建议发布: ${view.summary.recommendApproveCount} | 谨慎发布: ${view.summary.recommendCautionCount} | 阻止发布: ${view.summary.recommendBlockCount}`);
    lines.push('');

    for (const industry of view.industries) {
      const rules = view.rulesByIndustry[industry];
      if (!rules || rules.length === 0) continue;

      lines.push(`【${industry} 行业规则】`);
      lines.push('');

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const statusLabel = this.getRuleStatusLabel(rule.status);
        const recLabel = rule.publishRecommendation === 'approve' ? '✅ 建议发布' :
                         rule.publishRecommendation === 'caution' ? '⚠️ 谨慎发布' :
                         rule.publishRecommendation === 'block' ? '❌ 阻止发布' : '⏳ 待分析';

        lines.push(`  ${i + 1}. 版本 ${rule.version} [${statusLabel}] ${rule.isDefault ? '⭐ 默认' : ''} ${rule.isOverridden ? '🔄 已覆盖' : ''}`);
        lines.push(`     说明: ${rule.description}`);
        lines.push(`     发布建议: ${recLabel}`);
        lines.push(`     建议理由: ${rule.recommendationReason}`);
        lines.push(`     最近变更: ${this.formatStatusTransition(rule.lastChange.fromStatus, rule.lastChange.toStatus)} (${rule.lastChange.changedAt})`);
        if (rule.lastChange.remark) {
          lines.push(`     变更备注: ${rule.lastChange.remark}`);
        }
        if (rule.impactSummary) {
          lines.push(`     影响分析: ${rule.impactSummary.analyzedProducts} 个产品, 等级下降 ${rule.impactSummary.gradeDeclines} 个, 新增风险 ${rule.impactSummary.newRisks} 个`);
          lines.push(`     平均分变化: ${rule.impactSummary.averageScoreChange > 0 ? '+' : ''}${rule.impactSummary.averageScoreChange}%`);
        }
        if (rule.publishedAt) lines.push(`     发布时间: ${rule.publishedAt}`);
        if (rule.trialStartAt) lines.push(`     试运行: ${rule.trialStartAt}${rule.trialEndAt ? ' ~ ' + rule.trialEndAt : ''}`);
        if (rule.changeLog) lines.push(`     变更日志: ${rule.changeLog}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private formatRuleReviewViewMarkdown(view: any): string {
    const lines: string[] = [];
    lines.push('# 规则评审视图');
    lines.push('');
    lines.push(`> 评审ID：\`${view.reviewId}\``);
    lines.push(`> 生成时间：${view.generatedAt}`);
    lines.push(`> 涉及行业：${view.industries.join('、')}`);
    lines.push('');

    lines.push('## 📊 规则汇总');
    lines.push('');
    lines.push('| 指标 | 数量 |');
    lines.push('| :--- | ---: |');
    lines.push(`| 📝 总规则数 | ${view.summary.totalRules} |`);
    lines.push(`| ✏️ 草稿 | ${view.summary.draftCount} |`);
    lines.push(`| 🧪 试运行 | ${view.summary.trialCount} |`);
    lines.push(`| ✅ 已发布 | ${view.summary.publishedCount} |`);
    lines.push(`| ⏹️ 已停用 | ${view.summary.deprecatedCount} |`);
    lines.push(`| ⏳ 待评审 | ${view.summary.pendingReviewCount} |`);
    lines.push('');

    lines.push('## 🎯 发布建议汇总');
    lines.push('');
    lines.push('| 建议 | 数量 |');
    lines.push('| :--- | ---: |');
    lines.push(`| ✅ 建议发布 | ${view.summary.recommendApproveCount} |`);
    lines.push(`| ⚠️ 谨慎发布 | ${view.summary.recommendCautionCount} |`);
    lines.push(`| ❌ 阻止发布 | ${view.summary.recommendBlockCount} |`);
    lines.push('');

    for (const industry of view.industries) {
      const rules = view.rulesByIndustry[industry];
      if (!rules || rules.length === 0) continue;

      lines.push(`## 🏢 ${industry} 行业规则`);
      lines.push('');

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const statusLabel = this.getRuleStatusLabel(rule.status);
        const recLabel = rule.publishRecommendation === 'approve' ? '✅ 建议发布' :
                         rule.publishRecommendation === 'caution' ? '⚠️ 谨慎发布' :
                         rule.publishRecommendation === 'block' ? '❌ 阻止发布' : '⏳ 待分析';
        const recColor = rule.publishRecommendation === 'approve' ? 'success' :
                         rule.publishRecommendation === 'caution' ? 'warning' :
                         rule.publishRecommendation === 'block' ? 'danger' : 'muted';

        lines.push(`### ${i + 1}. 版本 \`${rule.version}\``);
        lines.push('');
        lines.push('| 项目 | 内容 |');
        lines.push('| :--- | :--- |');
        lines.push(`| 版本号 | ${rule.version} |`);
        lines.push(`| 状态 | ${statusLabel} |`);
        lines.push(`| 说明 | ${rule.description} |`);
        lines.push(`| 来源 | ${rule.source} |`);
        if (rule.isDefault) lines.push(`| 默认版本 | ✅ 是 |`);
        if (rule.isOverridden) lines.push(`| 配置覆盖 | 🔄 是（使用自定义覆盖配置） |`);
        lines.push(`| 发布建议 | ${recLabel} |`);
      lines.push(`| 建议理由 | ${rule.recommendationReason} |`);
      lines.push(`| 最近变更 | ${this.formatStatusTransition(rule.lastChange.fromStatus, rule.lastChange.toStatus)} |`);
      lines.push(`| 变更时间 | ${rule.lastChange.changedAt} |`);
      if (rule.lastChange.remark) lines.push(`| 变更备注 | ${rule.lastChange.remark} |`);
        if (rule.publishedAt) lines.push(`| 发布时间 | ${rule.publishedAt} |`);
        if (rule.trialStartAt) lines.push(`| 试运行时间 | ${rule.trialStartAt}${rule.trialEndAt ? ' ~ ' + rule.trialEndAt : ''} |`);
        if (rule.registeredAt) lines.push(`| 注册时间 | ${rule.registeredAt} |`);
        if (rule.changeLog) lines.push(`| 变更日志 | ${rule.changeLog} |`);
        lines.push('');

        if (rule.impactSummary) {
          lines.push('#### 影响分析摘要');
          lines.push('');
          lines.push('| 指标 | 数值 |');
          lines.push('| :--- | ---: |');
          lines.push(`| 分析产品数 | ${rule.impactSummary.analyzedProducts} 个 |`);
          lines.push(`| 等级下降 | ${rule.impactSummary.gradeDeclines} 个 |`);
          lines.push(`| 新增风险 | ${rule.impactSummary.newRisks} 个 |`);
          lines.push(`| 平均分变化 | ${rule.impactSummary.averageScoreChange > 0 ? '+' : ''}${rule.impactSummary.averageScoreChange}% |`);
          if (rule.impactSummary.lastAnalyzedAt) {
            lines.push(`| 分析时间 | ${rule.impactSummary.lastAnalyzedAt} |`);
          }
          lines.push('');
        }

        if (rule.requiredFields.length > 0 || rule.recommendedFields.length > 0) {
          lines.push('#### 字段配置');
          lines.push('');
          if (rule.requiredFields.length > 0) {
            lines.push(`**必填字段 (${rule.requiredFields.length} 个)**：\`${rule.requiredFields.join('`、`')}\``);
            lines.push('');
          }
          if (rule.recommendedFields.length > 0) {
            lines.push(`**推荐字段 (${rule.recommendedFields.length} 个)**：\`${rule.recommendedFields.join('`、`')}\``);
            lines.push('');
          }
        }
      }
    }

    return lines.join('\n');
  }
}
