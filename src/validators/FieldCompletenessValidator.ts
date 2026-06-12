import { FieldDefinition, FieldCompletenessResult, IndustryType, RiskItem } from '../types';
import { INDUSTRY_REQUIRED_FIELDS } from '../config';
import { DetailLogger } from '../core/logger';

export class FieldCompletenessValidator {
  private logger: DetailLogger;

  constructor(logger: DetailLogger) {
    this.logger = logger;
  }

  validate(
    fields: FieldDefinition[],
    industry: IndustryType = 'general'
  ): { result: FieldCompletenessResult; risks: RiskItem[] } {
    this.logger.info('FieldCompletenessValidator', `开始校验字段完整性，行业: ${industry}`);

    const industryConfig = INDUSTRY_REQUIRED_FIELDS[industry];
    const fieldNames = fields.map((f) => f.name);
    const fieldMap = new Map(fields.map((f) => [f.name, f]));

    const missingRequiredFields = industryConfig.required.filter(
      (name: string) => !fieldNames.includes(name)
    );
    const missingOptionalFields = industryConfig.recommended.filter(
      (name: string) => !fieldNames.includes(name)
    );

    const fieldsWithDescription = fields.filter((f) => f.description && f.description.trim().length > 0).map((f) => f.name);
    const fieldsWithoutDescription = fields.filter((f) => !f.description || f.description.trim().length === 0).map((f) => f.name);

    const requiredScore = Math.max(
      0,
      ((industryConfig.required.length - missingRequiredFields.length) /
        Math.max(1, industryConfig.required.length)) *
        50
    );
    const optionalScore = Math.max(
      0,
      ((industryConfig.recommended.length - missingOptionalFields.length) /
        Math.max(1, industryConfig.recommended.length)) *
        20
    );
    const descriptionScore = Math.max(
      0,
      (fieldsWithDescription.length / Math.max(1, fields.length)) * 30
    );

    const maxScore = 100;
    const score = Math.round(requiredScore + optionalScore + descriptionScore);

    this.logger.debug('FieldCompletenessValidator', '字段完整性评分详情', {
      requiredScore,
      optionalScore,
      descriptionScore,
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
    };

    this.logger.info('FieldCompletenessValidator', `字段完整性校验完成，得分: ${score}/${maxScore}`);

    return { result, risks };
  }
}
