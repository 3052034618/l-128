import {
  ScoringWeights,
  IndustryType,
  IndustryRequiredFieldsConfig,
  UpdateFrequencyType,
  SensitiveType,
  DataSensitivityLevel,
  DataProductDescription,
  WeightValidationResult,
  ZeroWeightDimension,
} from '../types';

export const DEFAULT_AUDIT_PASS_THRESHOLD = 70;

export const DIMENSION_NAMES: Record<keyof ScoringWeights, string> = {
  fieldCompleteness: '字段完整性',
  sampleCompleteness: '样本完整性',
  sensitiveField: '敏感字段',
  updateFrequency: '更新频率',
  descriptionCompleteness: '描述完整性',
  authorization: '授权范围',
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  fieldCompleteness: 25,
  sampleCompleteness: 25,
  sensitiveField: 20,
  updateFrequency: 10,
  descriptionCompleteness: 10,
  authorization: 10,
};

export const DEFAULT_WEIGHT_SUM = 100;

export const INDUSTRY_REQUIRED_FIELDS: Record<string, IndustryRequiredFieldsConfig> = {
  finance: {
    version: 'v1.0',
    description: '金融行业必填字段配置（内置v1.0）',
    required: ['userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency'],
    recommended: ['merchantName', 'transactionType', 'riskLevel', 'cardType', 'bankCode'],
  },
  healthcare: {
    version: 'v1.0',
    description: '医疗健康行业必填字段配置（内置v1.0）',
    required: ['patientId', 'visitTime', 'department', 'diagnosis', 'doctorId'],
    recommended: ['age', 'gender', 'insuranceType', 'medication', 'treatmentPlan'],
  },
  education: {
    version: 'v1.0',
    description: '教育行业必填字段配置（内置v1.0）',
    required: ['studentId', 'courseId', 'enrollmentTime', 'grade', 'schoolId'],
    recommended: ['teacherId', 'className', 'subject', 'score', 'attendanceRate'],
  },
  retail: {
    version: 'v1.0',
    description: '零售行业必填字段配置（内置v1.0）',
    required: ['orderId', 'productId', 'quantity', 'price', 'orderTime'],
    recommended: ['customerId', 'sku', 'category', 'storeId', 'paymentMethod'],
  },
  transportation: {
    version: 'v1.0',
    description: '交通出行行业必填字段配置（内置v1.0）',
    required: ['tripId', 'vehicleId', 'startTime', 'startLocation', 'endLocation'],
    recommended: ['driverId', 'passengerCount', 'distance', 'fare', 'tripType'],
  },
  government: {
    version: 'v1.0',
    description: '政务行业必填字段配置（内置v1.0）',
    required: ['recordId', 'department', 'applicationTime', 'applicantId', 'status'],
    recommended: ['businessType', 'region', 'approvalTime', 'handler', 'result'],
  },
  manufacturing: {
    version: 'v1.0',
    description: '制造业必填字段配置（内置v1.0）',
    required: ['productBatchId', 'productionLine', 'productionTime', 'materialId', 'quantity'],
    recommended: ['qualityInspection', 'equipmentId', 'workerId', 'warehouseId', 'supplierId'],
  },
  general: {
    version: 'v1.0',
    description: '通用行业必填字段配置（内置v1.0）',
    required: ['id', 'createdAt'],
    recommended: ['updatedAt', 'status', 'description', 'createdBy'],
  },
};

export function getIndustryConfig(
  industry: IndustryType,
  customConfigs?: Record<string, IndustryRequiredFieldsConfig>
): IndustryRequiredFieldsConfig & { key: string } {
  const customConfig = customConfigs?.[industry];
  if (customConfig) {
    return {
      ...customConfig,
      version: customConfig.version || 'custom',
      description: customConfig.description || `${industry} 自定义配置`,
      key: industry,
    };
  }
  const builtIn = INDUSTRY_REQUIRED_FIELDS[industry];
  if (builtIn) {
    return { ...builtIn, key: industry };
  }
  const general = INDUSTRY_REQUIRED_FIELDS['general'];
  return { ...general, key: industry, description: `${industry}（回退至通用配置 v1.0）` };
}

export const UPDATE_FREQUENCY_SCORES: Record<UpdateFrequencyType, number> = {
  realtime: 100,
  hourly: 90,
  daily: 80,
  weekly: 60,
  monthly: 40,
  quarterly: 25,
  yearly: 15,
  unknown: 0,
};

export const GRADE_THRESHOLDS: Array<{ grade: string; minScore: number }> = [
  { grade: 'S', minScore: 90 },
  { grade: 'A', minScore: 80 },
  { grade: 'B', minScore: 70 },
  { grade: 'C', minScore: 60 },
  { grade: 'D', minScore: 0 },
];

export interface SensitiveFieldPattern {
  pattern: RegExp;
  type: SensitiveType;
  level: DataSensitivityLevel;
  description: string;
  patternKey?: string;
}

export const DEFAULT_SENSITIVE_FIELD_PATTERNS: SensitiveFieldPattern[] = [
  {
    pattern: /(^|[-_\.])(idcard|id_card|身份证|身份证号|identity_card|national_id|ssn|social_security)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'secret',
    description: '身份证号码/社会保障号',
    patternKey: 'id_card',
  },
  {
    pattern: /(^|[-_\.])(name|fullname|full_name|姓名|realname|real_name|user_name|username|userName|realName|fullName)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'confidential',
    description: '真实姓名/用户名',
    patternKey: 'real_name',
  },
  {
    pattern: /(^|[-_\.])(phone|mobile|telephone|手机号|电话|联系方式|contact|phoneNumber|phone_number|mobileNumber|mobile_number|cellphone|cell_phone|tel)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '手机号码/联系电话',
    patternKey: 'phone',
  },
  {
    pattern: /(^|[-_\.])(email|mail|邮箱|电子邮件|e_mail|emailAddress|email_address)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '电子邮箱',
    patternKey: 'email',
  },
  {
    pattern: /(^|[-_\.])(address|住址|地址|居住地址|home_address|residence|homeAddress|residentialAddress)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '居住地址',
    patternKey: 'address',
  },
  {
    pattern: /(^|[-_\.])(bankcard|bank_card|银行卡|card_no|card_number|cardNumber|account_no|account_number|accountNumber|accountId|account_id|卡号|账号|acct|acct_no|acctNo|bankAccount|bank_account)([-_\.]|$)/i,
    type: 'financial',
    level: 'secret',
    description: '银行卡号/银行账号',
    patternKey: 'bank_account',
  },
  {
    pattern: /(^|[-_\.])(creditcard|credit_card|信用卡|cvv|cvv2)([-_\.]|$)/i,
    type: 'financial',
    level: 'secret',
    description: '信用卡信息',
    patternKey: 'credit_card',
  },
  {
    pattern: /(^|[-_\.])(salary|income|工资|收入|amount|balance|金额|余额|monthlyIncome|annualIncome)([-_\.]|$)/i,
    type: 'financial',
    level: 'confidential',
    description: '收入/金额/余额信息',
    patternKey: 'financial_amount',
  },
  {
    pattern: /(^|[-_\.])(disease|illness|诊断|病情|病历|medical_record|medicalRecord|diagnosis|symptom|症状|medicalHistory|medical_history)([-_\.]|$)/i,
    type: 'health_medical',
    level: 'secret',
    description: '疾病诊断/病历信息',
    patternKey: 'medical_record',
  },
  {
    pattern: /(^|[-_\.])(medicine|drug|药品|处方|prescription|treatment|治疗|medication)([-_\.]|$)/i,
    type: 'health_medical',
    level: 'confidential',
    description: '药品/处方/治疗信息',
    patternKey: 'prescription',
  },
  {
    pattern: /(^|[-_\.])(fingerprint|指纹|face|人脸|iris|虹膜|voiceprint|声纹|biometric|生物特征|facial|faceImage|face_image)([-_\.]|$)/i,
    type: 'biometric',
    level: 'secret',
    description: '生物特征信息',
    patternKey: 'biometric',
  },
  {
    pattern: /(^|[-_\.])(gps|location|位置|经纬度|latitude|longitude|坐标|address_lat|address_lng|lat|lng|gpsLocation|geo|geolocation)([-_\.]|$)/i,
    type: 'location',
    level: 'confidential',
    description: '位置/坐标信息',
    patternKey: 'location',
  },
  {
    pattern: /(^|[-_\.])(passport|护照|driverlicense|driver_license|driverLicense|驾照|驾驶证|visa|签证|drivingLicense)([-_\.]|$)/i,
    type: 'government_id',
    level: 'secret',
    description: '护照/驾照/签证等证件号码',
    patternKey: 'gov_id',
  },
  {
    pattern: /(^|[-_\.])(school|学校|education|学历|major|专业|degree|学位|grade|成绩|score|graduation|graduationSchool|alma_mater)([-_\.]|$)/i,
    type: 'education',
    level: 'internal',
    description: '教育背景信息',
    patternKey: 'education',
  },
  {
    pattern: /(^|[-_\.])(company|公司|employer|雇主|position|职位|department|部门|job|职业|work_experience|workExperience|companyName|company_name|occupation|jobTitle|job_title)([-_\.]|$)/i,
    type: 'employment',
    level: 'internal',
    description: '工作/职业信息',
    patternKey: 'employment',
  },
  {
    pattern: /(^|[-_\.])(age|年龄|birthday|生日|birthdate|birth_date|birthDate|dob|gender|性别|sex|marital|婚姻|nationality|国籍)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'internal',
    description: '年龄/生日/性别/婚姻/国籍',
    patternKey: 'personal_basic',
  },
  {
    pattern: /(^|[-_\.])(userId|user_id|memberId|member_id|customerId|customer_id|uid|uuid|openid|open_id|unionid|union_id)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'internal',
    description: '用户唯一标识',
    patternKey: 'user_id',
  },
  {
    pattern: /(^|[-_\.])(wechat|weixin|微信|qq|alipay|支付宝|social_account|socialAccount)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '社交/支付账号',
    patternKey: 'social_account',
  },
];

export const DESCRIPTION_REQUIRED_FIELDS: Array<{ key: keyof DataProductDescription; weight: number; label: string }> = [
  { key: 'productName', weight: 15, label: '数据产品名称' },
  { key: 'description', weight: 25, label: '数据产品描述' },
  { key: 'dataSource', weight: 20, label: '数据来源' },
  { key: 'coveragePeriod', weight: 20, label: '数据覆盖周期' },
  { key: 'updateFrequency', weight: 20, label: '更新频率' },
];

export const HIGH_MISSING_RATE_THRESHOLD = 0.3;

export const MAX_DETAIL_LOG_ENTRIES = 1000;

export const LOW_SCORE_THRESHOLD = 60;

export function validateAndNormalizeWeights(
  customWeights: Partial<ScoringWeights>,
  baseWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  autoNormalize: boolean = true,
  handleZeroWeightAs: 'exclude' | 'normalize' | 'warn' = 'warn'
): WeightValidationResult & { zeroWeightDimensions: ZeroWeightDimension[] } {
  const warnings: string[] = [];
  const zeroWeightDimensions: ZeroWeightDimension[] = [];
  const mergedWeights: ScoringWeights = {
    fieldCompleteness: customWeights.fieldCompleteness ?? baseWeights.fieldCompleteness,
    sampleCompleteness: customWeights.sampleCompleteness ?? baseWeights.sampleCompleteness,
    sensitiveField: customWeights.sensitiveField ?? baseWeights.sensitiveField,
    updateFrequency: customWeights.updateFrequency ?? baseWeights.updateFrequency,
    descriptionCompleteness: customWeights.descriptionCompleteness ?? baseWeights.descriptionCompleteness,
    authorization: customWeights.authorization ?? baseWeights.authorization,
  };

  const originalWeights = { ...mergedWeights };
  let wasNormalized = false;

  for (const key of Object.keys(mergedWeights) as (keyof ScoringWeights)[]) {
    const value = mergedWeights[key];
    const name = DIMENSION_NAMES[key];

    if (typeof value !== 'number' || isNaN(value)) {
      warnings.push(`权重 ${key} 不是有效数字 (${value})，已使用默认值 ${baseWeights[key]}`);
      mergedWeights[key] = baseWeights[key];
      wasNormalized = true;
    } else if (value < 0) {
      warnings.push(`权重 ${key} 为负数 (${value})，已修正为 0`);
      mergedWeights[key] = 0;
      wasNormalized = true;
    }

    if (mergedWeights[key] === 0) {
      const isExplicit = customWeights[key] === 0 || (customWeights[key] as any) < 0;
      let note = '';
      if (handleZeroWeightAs === 'exclude') {
        note = `该维度权重为 0，将不计入总分计算，也不参与归一化`;
        warnings.push(`维度 ${name} (${key}) 权重为 0，将不计入总分，不参与归一化`);
      } else if (handleZeroWeightAs === 'normalize') {
        note = `该维度权重为 0，将参与归一化计算，归一化后可能仍为 0`;
        if (isExplicit) {
          warnings.push(`维度 ${name} (${key}) 权重被显式设为 0，将参与归一化计算`);
        }
      } else {
        note = `该维度权重为 0，归一化后仍为 0，该维度评分不影响总分`;
        if (isExplicit) {
          warnings.push(`维度 ${name} (${key}) 权重被显式设为 0，该维度评分将不影响总分`);
        }
      }
      zeroWeightDimensions.push({
        dimensionKey: key,
        dimensionName: name,
        isExplicitlyZero: isExplicit,
        handlingStrategy: handleZeroWeightAs === 'warn' ? 'normalize' : handleZeroWeightAs,
        note,
      });
    }
  }

  const originalSum = Object.values(originalWeights).reduce((s, v) => s + (isNaN(v) ? 0 : v), 0);
  let currentSum = Object.values(mergedWeights).reduce((s, v) => s + v, 0);

  let normalizedWeights = { ...mergedWeights };
  if (handleZeroWeightAs === 'exclude') {
    const nonZeroKeys = (Object.keys(mergedWeights) as (keyof ScoringWeights)[]).filter(
      (k) => mergedWeights[k] > 0
    );
    if (nonZeroKeys.length === 0) {
      warnings.push(`所有权重均为 0，已回退至默认权重配置`);
      Object.assign(normalizedWeights, DEFAULT_SCORING_WEIGHTS);
      wasNormalized = true;
    } else {
      const nonZeroSum = nonZeroKeys.reduce((s, k) => s + mergedWeights[k], 0);
      if (autoNormalize && Math.abs(nonZeroSum - DEFAULT_WEIGHT_SUM) > 0.001) {
        const scale = DEFAULT_WEIGHT_SUM / nonZeroSum;
        for (const key of nonZeroKeys) {
          normalizedWeights[key] = Math.round(mergedWeights[key] * scale * 100) / 100;
        }
        warnings.push(`所有权重非零总和 (${nonZeroSum}) 不等于 100，已自动按比例归一化（零权重维度保持 0）`);
        wasNormalized = true;
      }
    }
  } else {
    if (currentSum <= 0) {
      warnings.push(`所有权重总和为 0，已回退至默认权重配置`);
      Object.assign(normalizedWeights, DEFAULT_SCORING_WEIGHTS);
      wasNormalized = true;
    } else if (autoNormalize && Math.abs(currentSum - DEFAULT_WEIGHT_SUM) > 0.001) {
      const scale = DEFAULT_WEIGHT_SUM / currentSum;
      for (const key of Object.keys(normalizedWeights) as (keyof ScoringWeights)[]) {
        normalizedWeights[key] = Math.round(normalizedWeights[key] * scale * 100) / 100;
      }
      warnings.push(`权重总和 (${originalSum}) 不等于 100，已自动按比例归一化`);
      wasNormalized = true;
    }
  }

  return {
    isValid: warnings.length === 0,
    normalizedWeights,
    warnings,
    wasNormalized,
    originalSum,
    zeroWeightDimensions,
  };
}

export function getZeroWeightDimensions(
  weights: ScoringWeights,
  originalWeights: Partial<ScoringWeights>,
  strategy: 'exclude' | 'normalize' | 'warn' = 'warn'
): ZeroWeightDimension[] {
  const result: ZeroWeightDimension[] = [];
  for (const key of Object.keys(weights) as (keyof ScoringWeights)[]) {
    if (weights[key] === 0) {
      const isExplicit = originalWeights[key] === 0 || (originalWeights[key] as any) < 0;
      result.push({
        dimensionKey: key,
        dimensionName: DIMENSION_NAMES[key],
        isExplicitlyZero: isExplicit,
        handlingStrategy: strategy === 'warn' ? 'normalize' : strategy,
        note: isExplicit
          ? `权重被显式设为 0，${strategy === 'exclude' ? '不计入总分' : '归一化后仍为 0，不影响总分'}`
          : `权重经修正后为 0，不影响总分`,
      });
    }
  }
  return result;
}

export function safePercentage(value: number, total: number, decimals: number = 2): number {
  if (!isFinite(value) || !isFinite(total) || total === 0) return 0;
  const pct = (value / total) * 100;
  if (!isFinite(pct) || isNaN(pct)) return 0;
  return Math.round(pct * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function clampScore(score: number, min: number = 0, max: number = 100): number {
  if (!isFinite(score) || isNaN(score)) return min;
  return Math.max(min, Math.min(max, Math.round(score)));
}
