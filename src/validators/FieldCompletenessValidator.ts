import {
  FieldDefinition,
  FieldCompletenessResult,
  IndustryType,
  RiskItem,
  IndustryRequiredFieldsConfig,
} from '../types';
import { getIndustryConfig, clampScore, safePercentage } from '../config';
import { DetailLogger } from '../core/logger';

export class FieldCompletenessValidator {
  private logger: DetailLogger;
  private customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;

  constructor(
    logger: DetailLogger,
    customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>
  ) {
    this.logger = logger;
    this.customIndustryConfigs = customIndustryConfigs;
  }

  validate(
    fields: FieldDefinition[],
    industry: IndustryType = 'general'
  ): { result: FieldCompletenessResult; risks: RiskItem[] } {
    this.logger.info('FieldCompletenessValidator', `开始校验字段完整性，行业: ${industry}`);

    const industryConfig = getIndustryConfig(industry, this.customIndustryConfigs);
    this.logger.debug('FieldCompletenessValidator', `使用行业配置: ${industryConfig.description} (version: ${industryConfig.version || 'unknown'})`);

    const fieldNames = fields.map((f) => f.name);

    const missingRequiredFields = industryConfig.required.filter(
      (name: string) => !fieldNames.includes(name)
    );
    const missingOptionalFields = industryConfig.recommended.filter(
      (name: string) => !fieldNames.includes(name)
    );

    const fieldsWithDescription = fields.filter((f) => f.description && f.description.trim().length > 0).map((f) => f.name);
    const fieldsWithoutDescription = fields.filter((f) => !f.description || f.description.trim().length === 0).map((f) => f.name);

    const requiredRate = industryConfig.required.length > 0
      ? (industryConfig.required.length - missingRequiredFields.length) / industryConfig.required.length
      : 1;
    const optionalRate = industryConfig.recommended.length > 0
      ? (industryConfig.recommended.length - missingOptionalFields.length) / industryConfig.recommended.length
      : 1;
    const descriptionRate = fields.length > 0
      ? fieldsWithDescription.length / fields.length
      : 1;

    const requiredScore = requiredRate * 50;
    const optionalScore = optionalRate * 20;
    const descriptionScore = descriptionRate * 30;

    const score = clampScore(requiredScore + optionalScore + descriptionScore);
    const maxScore = 100;

    this.logger.debug('FieldCompletenessValidator', '字段完整性评分详情', {
      requiredScore: clampScore(requiredScore),
      optionalScore: clampScore(optionalScore),
      descriptionScore: clampScore(descriptionScore),
      finalScore: score,
    });

    const risks: RiskItem[] = [];

    if (missingRequiredFields.length > 0) {
      risks.push({
        id: `field-required-missing-${industry}`,
        category: 'field_completeness',
        level: missingRequiredFields.length >= 3 ? 'high' : 'medium',
        message: `缺失 ${missingRequiredFields.length} 个行业必填字段: ${missingRequiredFields.join(', ')}`,
        suggestion: `请补充以下必填字段: ${missingRequiredFields.join(', ')}，这些是${industryConfig.description}的核心字段`,
        relatedFields: missingRequiredFields,
        evidence: [
          {
            type: 'field',
            description: '命中的行业必填字段规则',
            fields: missingRequiredFields,
            value: `规则版本: ${industryConfig.version || 'custom'}, 共需 ${industryConfig.required.length} 个必选字段，缺失 ${missingRequiredFields.length} 个`,
            expected: industryConfig.required.join(', '),
          },
          {
            type: 'count',
            description: '必选字段完整率',
            value: `${safePercentage(requiredRate * 100, 100)}% (${industryConfig.required.length - missingRequiredFields.length}/${industryConfig.required.length})`,
          },
        ],
      });
      this.logger.warn('FieldCompletenessValidator', `缺失必填字段: ${missingRequiredFields.join(', ')}`);
    }

    if (missingOptionalFields.length > 0) {
      risks.push({
        id: `field-recommended-missing-${industry}`,
        category: 'field_completeness',
        level: 'low',
        message: `缺失 ${missingOptionalFields.length} 个行业推荐字段: ${missingOptionalFields.join(', ')}`,
        suggestion: `建议补充以下推荐字段以提升数据质量: ${missingOptionalFields.join(', ')}`,
        relatedFields: missingOptionalFields,
        evidence: [
          {
            type: 'field',
            description: '命中的行业推荐字段规则',
            fields: missingOptionalFields,
            value: `共推荐 ${industryConfig.recommended.length} 个字段，缺失 ${missingOptionalFields.length} 个`,
          },
        ],
      });
    }

    if (fieldsWithoutDescription.length > 0) {
      risks.push({
        id: 'field-description-missing',
        category: 'field_completeness',
        level: fieldsWithoutDescription.length > fields.length / 2 ? 'medium' : 'low',
        message: `${fieldsWithoutDescription.length} 个字段缺少描述说明`,
        suggestion: '建议为所有字段添加清晰的描述说明，包括字段含义、取值范围等',
        relatedFields: fieldsWithoutDescription,
        evidence: [
          {
            type: 'count',
            description: '字段描述覆盖率',
            value: `${fieldsWithDescription.length}/${fields.length} (${safePercentage(fieldsWithDescription.length, fields.length)}%)`,
            expected: '建议 100% 字段都有描述',
          },
          {
            type: 'field',
            description: '缺少描述的字段列表',
            fields: fieldsWithoutDescription,
          },
        ],
      });
    }

    const result: FieldCompletenessResult = {
      score,
      maxScore,
      requiredFields: industryConfig.required,
      missingRequiredFields,
      optionalFields: industryConfig.recommended,
      missingOptionalFields,
      fieldsWithDescription,
      fieldsWithoutDescription,
      ruleVersion: industryConfig.version,
      ruleDescription: industryConfig.description,
    };

    this.logger.info('FieldCompletenessValidator', `字段完整性校验完成，得分: ${score}/${maxScore}`);

    return { result, risks };
  }
}
