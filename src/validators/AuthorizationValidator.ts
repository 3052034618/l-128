import { AuthorizationResult, AuthorizationScope, RiskItem } from '../types';
import { clampScore, safePercentage } from '../config';
import { DetailLogger } from '../core/logger';

export class AuthorizationValidator {
  private logger: DetailLogger;

  constructor(logger: DetailLogger) {
    this.logger = logger;
  }

  validate(authorization: AuthorizationScope): { result: AuthorizationResult; risks: RiskItem[] } {
    this.logger.info('AuthorizationValidator', '开始校验授权范围完整性');

    const risks: RiskItem[] = [];

    const hasPurpose = !!(authorization.allowedPurposes && authorization.allowedPurposes.length > 0);
    const hasRetention = !!(authorization.retentionPeriod !== undefined && authorization.retentionPeriod.trim().length > 0);
    const hasRecipients = !!(authorization.allowedRecipients && authorization.allowedRecipients.length > 0);
    const hasRegions = !!(authorization.dataProcessingRegions && authorization.dataProcessingRegions.length > 0);

    let coveredItems = 0;
    const totalItems = 4;
    if (hasPurpose) coveredItems++;
    if (hasRetention) coveredItems++;
    if (hasRecipients) coveredItems++;
    if (hasRegions) coveredItems++;

    const scopeCoverage = isFinite(coveredItems / totalItems) && !isNaN(coveredItems / totalItems)
      ? coveredItems / totalItems
      : 0;

    let score = 0;
    if (hasPurpose) score += 40;
    if (hasRetention) score += 25;
    if (hasRecipients) score += 20;
    if (hasRegions) score += 15;
    score = clampScore(score);

    this.logger.debug('AuthorizationValidator', '授权范围评分详情', {
      hasPurpose,
      hasRetention,
      hasRecipients,
      hasRegions,
      scopeCoverage,
      finalScore: score,
    });

    if (!hasPurpose) {
      risks.push({
        id: 'auth-no-purpose',
        category: 'authorization',
        level: 'high',
        message: '未指定数据使用目的',
        suggestion: '请在授权范围中明确 allowedPurposes，说明数据可被用于哪些具体目的，如数据分析、用户画像、风控评估等',
        evidence: [
          {
            type: 'value',
            description: '使用目的 (allowedPurposes)',
            value: '未提供或为空数组',
            expected: '至少指定一个使用目的',
          },
        ],
      });
    }

    if (!hasRetention) {
      risks.push({
        id: 'auth-no-retention',
        category: 'authorization',
        level: 'medium',
        message: '未指定数据保留期限',
        suggestion: '请补充 retentionPeriod 字段，说明数据的最大保留期限，到期后应删除或脱敏处理',
        evidence: [
          {
            type: 'value',
            description: '保留期限 (retentionPeriod)',
            value: '未提供',
            expected: '例如: "3年"、"永久"、"2025-12-31"',
          },
        ],
      });
    }

    if (!hasRecipients) {
      risks.push({
        id: 'auth-no-recipients',
        category: 'authorization',
        level: 'medium',
        message: '未指定数据接收方范围',
        suggestion: '建议补充 allowedRecipients 字段，明确哪些主体可以接收和使用该数据',
        evidence: [
          {
            type: 'value',
            description: '接收方范围 (allowedRecipients)',
            value: '未提供',
            expected: '例如: ["风控部门", "数据分析团队"]',
          },
        ],
      });
    }

    if (!hasRegions) {
      risks.push({
        id: 'auth-no-regions',
        category: 'authorization',
        level: 'low',
        message: '未指定数据处理地域',
        suggestion: '建议补充 dataProcessingRegions 字段，说明数据允许在哪些地区进行处理和存储',
        evidence: [
          {
            type: 'value',
            description: '处理地域 (dataProcessingRegions)',
            value: '未提供',
            expected: '例如: ["中国大陆", "新加坡"]',
          },
        ],
      });
    }

    const result: AuthorizationResult = {
      score,
      maxScore: 100,
      hasPurpose,
      hasRetention,
      scopeCoverage,
    };

    this.logger.info('AuthorizationValidator', `授权范围校验完成，得分: ${score}/100`);

    return { result, risks };
  }
}
