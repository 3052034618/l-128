import {
  DescriptionCompletenessResult,
  DataProductDescription,
  RiskItem,
} from '../types';
import { DESCRIPTION_REQUIRED_FIELDS, clampScore, safePercentage } from '../config';
import { DetailLogger } from '../core/logger';

export class DescriptionCompletenessValidator {
  private logger: DetailLogger;

  constructor(logger: DetailLogger) {
    this.logger = logger;
  }

  validate(description: DataProductDescription | undefined): { result: DescriptionCompletenessResult; risks: RiskItem[] } {
    this.logger.info('DescriptionCompletenessValidator', '开始校验数据描述完整性');

    const risks: RiskItem[] = [];
    const providedFields: string[] = [];
    const missingFields: string[] = [];
    let score = 0;

    if (!description) {
      risks.push({
        id: 'description-missing',
        category: 'description_completeness',
        level: 'critical',
        message: '未提供任何数据产品描述信息',
        suggestion: '请提供完整的数据产品描述，包括产品名称、描述、数据来源、覆盖周期和更新频率等',
        evidence: [
          {
            type: 'count',
            description: '描述字段完成情况',
            value: '0/5 字段已填写',
            expected: '至少填写主要描述字段',
          },
        ],
      });

      const result: DescriptionCompletenessResult = {
        score: 0,
        maxScore: 100,
        providedFields: [],
        missingFields: DESCRIPTION_REQUIRED_FIELDS.map((f) => f.label),
      };

      this.logger.warn('DescriptionCompletenessValidator', '未提供数据产品描述');
      return { result, risks };
    }

    for (const fieldConfig of DESCRIPTION_REQUIRED_FIELDS) {
      const key = fieldConfig.key as keyof DataProductDescription;
      const value = description[key];
      const isProvided = this.isFieldProvided(value);

      if (isProvided) {
        providedFields.push(fieldConfig.label);
        score += fieldConfig.weight;
      } else {
        missingFields.push(fieldConfig.label);
      }
    }

    score = clampScore(score);

    this.logger.debug('DescriptionCompletenessValidator', '描述完整性评分详情', {
      providedFields,
      missingFields,
      finalScore: score,
    });

    if (missingFields.length > 0) {
      risks.push({
        id: 'description-incomplete',
        category: 'description_completeness',
        level: missingFields.length >= 3 ? 'high' : 'medium',
        message: `数据描述不完整，缺失 ${missingFields.length} 项: ${missingFields.join(', ')}`,
        suggestion: `请补充以下描述字段以提高数据质量: ${missingFields.join(', ')}`,
        evidence: [
          {
            type: 'count',
            description: '描述字段完整率',
            value: `${providedFields.length}/${DESCRIPTION_REQUIRED_FIELDS.length} (${safePercentage(providedFields.length, DESCRIPTION_REQUIRED_FIELDS.length)}%)`,
            fields: missingFields,
          },
        ],
      });
    }

    if (description.description && description.description.length < 20) {
      risks.push({
        id: 'description-too-short',
        category: 'description_completeness',
        level: 'low',
        message: '数据产品描述过短，信息量不足',
        suggestion: '建议提供更详细的数据产品描述，包括数据内容、使用场景、数据规模等信息',
        evidence: [
          {
            type: 'value',
            description: '数据描述长度',
            value: `${description.description.length} 字符`,
            expected: '建议 >= 20 字符',
          },
        ],
      });
    }

    const result: DescriptionCompletenessResult = {
      score,
      maxScore: 100,
      providedFields,
      missingFields,
    };

    this.logger.info('DescriptionCompletenessValidator', `描述完整性校验完成，得分: ${score}/100`);

    return { result, risks };
  }

  private isFieldProvided(value: any): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }
}
