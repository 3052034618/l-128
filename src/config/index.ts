import {
  ScoringWeights,
  IndustryType,
  IndustryRequiredFieldsConfig,
  UpdateFrequencyType,
  SensitiveType,
  DataSensitivityLevel,
  DataProductDescription,
} from '../types';

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  fieldCompleteness: 25,
  sampleCompleteness: 25,
  sensitiveField: 20,
  updateFrequency: 10,
  descriptionCompleteness: 10,
  authorization: 10,
};

export const INDUSTRY_REQUIRED_FIELDS: Record<IndustryType, IndustryRequiredFieldsConfig> = {
  finance: {
    description: '金融行业必填字段配置',
    required: ['userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency'],
    recommended: ['merchantName', 'transactionType', 'riskLevel', 'cardType', 'bankCode'],
  },
  healthcare: {
    description: '医疗健康行业必填字段配置',
    required: ['patientId', 'visitTime', 'department', 'diagnosis', 'doctorId'],
    recommended: ['age', 'gender', 'insuranceType', 'medication', 'treatmentPlan'],
  },
  education: {
    description: '教育行业必填字段配置',
    required: ['studentId', 'courseId', 'enrollmentTime', 'grade', 'schoolId'],
    recommended: ['teacherId', 'className', 'subject', 'score', 'attendanceRate'],
  },
  retail: {
    description: '零售行业必填字段配置',
    required: ['orderId', 'productId', 'quantity', 'price', 'orderTime'],
    recommended: ['customerId', 'sku', 'category', 'storeId', 'paymentMethod'],
  },
  transportation: {
    description: '交通出行行业必填字段配置',
    required: ['tripId', 'vehicleId', 'startTime', 'startLocation', 'endLocation'],
    recommended: ['driverId', 'passengerCount', 'distance', 'fare', 'tripType'],
  },
  government: {
    description: '政务行业必填字段配置',
    required: ['recordId', 'department', 'applicationTime', 'applicantId', 'status'],
    recommended: ['businessType', 'region', 'approvalTime', 'handler', 'result'],
  },
  manufacturing: {
    description: '制造业必填字段配置',
    required: ['productBatchId', 'productionLine', 'productionTime', 'materialId', 'quantity'],
    recommended: ['qualityInspection', 'equipmentId', 'workerId', 'warehouseId', 'supplierId'],
  },
  general: {
    description: '通用行业必填字段配置',
    required: ['id', 'createdAt'],
    recommended: ['updatedAt', 'status', 'description', 'createdBy'],
  },
};

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
}

export const DEFAULT_SENSITIVE_FIELD_PATTERNS: SensitiveFieldPattern[] = [
  {
    pattern: /(^|[-_\.])(idcard|id_card|身份证|身份证号|identity_card|national_id|ssn|social_security)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'secret',
    description: '身份证号码/社会保障号',
  },
  {
    pattern: /(^|[-_\.])(name|fullname|full_name|姓名|realname|real_name|user_name)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'confidential',
    description: '真实姓名',
  },
  {
    pattern: /(^|[-_\.])(phone|mobile|telephone|手机号|电话|联系方式|contact)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '手机号码/联系电话',
  },
  {
    pattern: /(^|[-_\.])(email|mail|邮箱|电子邮件|e_mail)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '电子邮箱',
  },
  {
    pattern: /(^|[-_\.])(address|住址|地址|居住地址|home_address|residence)([-_\.]|$)/i,
    type: 'personal_contact',
    level: 'confidential',
    description: '居住地址',
  },
  {
    pattern: /(^|[-_\.])(bankcard|bank_card|银行卡|card_no|card_number|account_no|account_number|卡号|账号)([-_\.]|$)/i,
    type: 'financial',
    level: 'secret',
    description: '银行卡号/银行账号',
  },
  {
    pattern: /(^|[-_\.])(creditcard|credit_card|信用卡|cvv|cvv2)([-_\.]|$)/i,
    type: 'financial',
    level: 'secret',
    description: '信用卡信息',
  },
  {
    pattern: /(^|[-_\.])(salary|income|工资|收入|amount|balance|金额|余额)([-_\.]|$)/i,
    type: 'financial',
    level: 'confidential',
    description: '收入/金额/余额信息',
  },
  {
    pattern: /(^|[-_\.])(disease|illness|诊断|病情|病历|medical_record|diagnosis|symptom|症状)([-_\.]|$)/i,
    type: 'health_medical',
    level: 'secret',
    description: '疾病诊断/病历信息',
  },
  {
    pattern: /(^|[-_\.])(medicine|drug|药品|处方|prescription|treatment|治疗)([-_\.]|$)/i,
    type: 'health_medical',
    level: 'confidential',
    description: '药品/处方/治疗信息',
  },
  {
    pattern: /(^|[-_\.])(fingerprint|指纹|face|人脸|iris|虹膜|voiceprint|声纹|biometric|生物特征)([-_\.]|$)/i,
    type: 'biometric',
    level: 'secret',
    description: '生物特征信息',
  },
  {
    pattern: /(^|[-_\.])(gps|location|位置|经纬度|latitude|longitude|坐标|address_lat|address_lng)([-_\.]|$)/i,
    type: 'location',
    level: 'confidential',
    description: '位置/坐标信息',
  },
  {
    pattern: /(^|[-_\.])(passport|护照|driverlicense|driver_license|驾照|驾驶证|visa|签证)([-_\.]|$)/i,
    type: 'government_id',
    level: 'secret',
    description: '护照/驾照/签证等证件号码',
  },
  {
    pattern: /(^|[-_\.])(school|学校|education|学历|major|专业|degree|学位|grade|成绩|score)([-_\.]|$)/i,
    type: 'education',
    level: 'internal',
    description: '教育背景信息',
  },
  {
    pattern: /(^|[-_\.])(company|公司|employer|雇主|position|职位|department|部门|job|职业|work_experience|工作经历)([-_\.]|$)/i,
    type: 'employment',
    level: 'internal',
    description: '工作/职业信息',
  },
  {
    pattern: /(^|[-_\.])(age|年龄|birthday|生日|birthdate|birth_date|dob|gender|性别|sex)([-_\.]|$)/i,
    type: 'personal_identity',
    level: 'internal',
    description: '年龄/生日/性别',
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
