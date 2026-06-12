import {
  FieldDefinition,
  SensitiveFieldResult,
  SensitiveFieldInfo,
  RiskItem,
  RiskLevel,
  AuthorizationScope,
  DataSensitivityLevel,
} from '../types';
import {
  DEFAULT_SENSITIVE_FIELD_PATTERNS,
  SensitiveFieldPattern,
} from '../config';
import { DetailLogger } from '../core/logger';

export class SensitiveFieldRecognizer {
  private logger: DetailLogger;
  private patterns: SensitiveFieldPattern[];

  constructor(
    logger: DetailLogger,
    customPatterns?: SensitiveFieldPattern[]
  ) {
    this.logger = logger;
    this.patterns = customPatterns
      ? [...DEFAULT_SENSITIVE_FIELD_PATTERNS, ...customPatterns]
      : [...DEFAULT_SENSITIVE_FIELD_PATTERNS];
  }

  addCustomPattern(pattern: SensitiveFieldPattern): void {
    this.patterns.push(pattern);
    this.logger.info('SensitiveFieldRecognizer', `已添加自定义敏感字段模式: ${pattern.pattern}`);
  }

  recognize(
    fields: FieldDefinition[],
    authorization: AuthorizationScope
  ): { result: SensitiveFieldResult; risks: RiskItem[] } {
    this.logger.info('SensitiveFieldRecognizer', `开始识别敏感字段，字段数: ${fields.length}`);

    const sensitiveFields: SensitiveFieldInfo[] = [];

    for (const field of fields) {
      const matchedPattern = this.matchSensitivePattern(field.name);
      if (matchedPattern) {
        const hasAuthorization = this.checkAuthorization(
          matchedPattern.level,
          authorization
        );

        sensitiveFields.push({
          fieldName: field.name,
          sensitivityType: matchedPattern.type,
          sensitivityLevel: matchedPattern.level,
          description: matchedPattern.description,
          hasAuthorization,
        });

        this.logger.debug('SensitiveFieldRecognizer', `识别到敏感字段: ${field.name} (${matchedPattern.description}, 级别: ${matchedPattern.level})`);
      }
    }

    let riskLevel: RiskLevel = 'low';
    if (sensitiveFields.length > 0) {
      const hasUnauthorizedSecret = sensitiveFields.some(
        (f) => f.sensitivityLevel === 'secret' && !f.hasAuthorization
      );
      const hasUnauthorizedConfidential = sensitiveFields.some(
        (f) => f.sensitivityLevel === 'confidential' && !f.hasAuthorization
      );

      if (hasUnauthorizedSecret) {
        riskLevel = 'critical';
      } else if (hasUnauthorizedConfidential) {
        riskLevel = 'high';
      } else if (sensitiveFields.length >= 5) {
        riskLevel = 'medium';
      }
    }

    let score = 100;
    const secretPenalty = sensitiveFields.filter(
      (f) => f.sensitivityLevel === 'secret'
    ).length * 15;
    const confidentialPenalty = sensitiveFields.filter(
      (f) => f.sensitivityLevel === 'confidential'
    ).length * 8;
    const internalPenalty = sensitiveFields.filter(
      (f) => f.sensitivityLevel === 'internal'
    ).length * 3;
    const unauthorizedPenalty = sensitiveFields.filter(
      (f) => !f.hasAuthorization
    ).length * 10;

    score = Math.max(0, 100 - secretPenalty - confidentialPenalty - internalPenalty - unauthorizedPenalty);

    this.logger.debug('SensitiveFieldRecognizer', '敏感字段评分详情', {
      sensitiveFieldCount: sensitiveFields.length,
      secretPenalty,
      confidentialPenalty,
      internalPenalty,
      unauthorizedPenalty,
      finalScore: score,
      riskLevel,
    });

    const risks: RiskItem[] = [];

    const unauthorizedSensitiveFields = sensitiveFields.filter((f) => !f.hasAuthorization);
    if (unauthorizedSensitiveFields.length > 0) {
      risks.push({
        id: 'sensitive-no-auth',
        category: 'sensitive_field',
        level: riskLevel,
        message: `${unauthorizedSensitiveFields.length} 个敏感字段未获得明确授权: ${unauthorizedSensitiveFields.map((f) => f.fieldName).join(', ')}`,
        suggestion: '请在授权范围中明确说明这些敏感字段的使用目的、使用方式和数据保留策略，确保合规性',
        relatedFields: unauthorizedSensitiveFields.map((f) => f.fieldName),
      });
    }

    const secretFields = sensitiveFields.filter((f) => f.sensitivityLevel === 'secret');
    if (secretFields.length > 0) {
      risks.push({
        id: 'sensitive-secret-fields',
        category: 'sensitive_field',
        level: 'high',
        message: `包含 ${secretFields.length} 个核心敏感(secret)字段: ${secretFields.map((f) => `${f.fieldName}(${f.description})`).join(', ')}`,
        suggestion: '核心敏感字段需特别关注，建议进行脱敏处理、访问控制加强和加密存储，并进行数据影响评估(DPIA)',
        relatedFields: secretFields.map((f) => f.fieldName),
      });
    }

    if (sensitiveFields.length > 0) {
      risks.push({
        id: 'sensitive-fields-detected',
        category: 'sensitive_field',
        level: 'low',
        message: `共检测到 ${sensitiveFields.length} 个敏感字段`,
        suggestion: '建议对所有敏感字段进行分类分级管理，建立数据访问审计机制，确保数据处理符合相关法规要求',
        relatedFields: sensitiveFields.map((f) => f.fieldName),
      });
    }

    const result: SensitiveFieldResult = {
      score,
      maxScore: 100,
      sensitiveFields,
      riskLevel,
    };

    this.logger.info('SensitiveFieldRecognizer', `敏感字段识别完成，检测到 ${sensitiveFields.length} 个敏感字段，得分: ${score}/100`);

    return { result, risks };
  }

  private matchSensitivePattern(fieldName: string): SensitiveFieldPattern | null {
    for (const pattern of this.patterns) {
      if (pattern.pattern.test(fieldName)) {
        return pattern;
      }
    }
    return null;
  }

  private checkAuthorization(
    sensitivityLevel: DataSensitivityLevel,
    authorization: AuthorizationScope
  ): boolean {
    const hasPurpose = authorization.allowedPurposes && authorization.allowedPurposes.length > 0;

    if (sensitivityLevel === 'public' || sensitivityLevel === 'internal') {
      return hasPurpose;
    }

    if (sensitivityLevel === 'confidential') {
      return (
        hasPurpose &&
        authorization.retentionPeriod !== undefined
      );
    }

    if (sensitivityLevel === 'secret') {
      return (
        hasPurpose &&
        authorization.retentionPeriod !== undefined &&
        authorization.allowedRecipients !== undefined &&
        authorization.allowedRecipients.length > 0
      );
    }

    return false;
  }
}
