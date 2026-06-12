export type IndustryType =
  | 'finance'
  | 'healthcare'
  | 'education'
  | 'retail'
  | 'transportation'
  | 'government'
  | 'manufacturing'
  | 'general';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export type QualityGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export type DataSensitivityLevel = 'public' | 'internal' | 'confidential' | 'secret';

export type UpdateFrequencyType =
  | 'realtime'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'unknown';

export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'unknown';
  description?: string;
  nullable?: boolean;
  example?: any;
}

export interface SampleSummary {
  totalRecords: number;
  fieldValues: Record<string, {
    nonNullCount: number;
    uniqueCount?: number;
    nullCount?: number;
    minValue?: number | string;
    maxValue?: number | string;
    sampleValues?: any[];
  }>;
}

export interface AuthorizationScope {
  allowedPurposes: string[];
  allowedRecipients?: string[];
  retentionPeriod?: string;
  dataProcessingRegions?: string[];
}

export interface DataProductDescription {
  productId: string;
  productName?: string;
  description?: string;
  dataSource?: string;
  coveragePeriod?: {
    start?: string;
    end?: string;
  };
  updateFrequency?: UpdateFrequencyType;
  lastUpdatedAt?: string;
}

export interface ScoringInput {
  productId: string;
  description?: DataProductDescription;
  fields: FieldDefinition[];
  sample: SampleSummary;
  authorization: AuthorizationScope;
  industry?: IndustryType;
  customWeights?: Partial<ScoringWeights>;
  enableDetailLog?: boolean;
}

export interface BatchScoringInput {
  items: ScoringInput[];
  globalOptions?: {
    customWeights?: Partial<ScoringWeights>;
    industry?: IndustryType;
    enableDetailLog?: boolean;
  };
}

export interface ScoringWeights {
  fieldCompleteness: number;
  sampleCompleteness: number;
  sensitiveField: number;
  updateFrequency: number;
  descriptionCompleteness: number;
  authorization: number;
}

export interface FieldCompletenessResult {
  score: number;
  maxScore: number;
  requiredFields: string[];
  missingRequiredFields: string[];
  optionalFields: string[];
  missingOptionalFields: string[];
  fieldsWithDescription: string[];
  fieldsWithoutDescription: string[];
}

export interface SampleCompletenessResult {
  score: number;
  maxScore: number;
  overallCompletionRate: number;
  fieldCompletionRates: Record<string, number>;
  fieldsWithHighMissingRate: string[];
  totalSampleRecords: number;
}

export interface SensitiveFieldResult {
  score: number;
  maxScore: number;
  sensitiveFields: SensitiveFieldInfo[];
  riskLevel: RiskLevel;
}

export interface SensitiveFieldInfo {
  fieldName: string;
  sensitivityType: SensitiveType;
  sensitivityLevel: DataSensitivityLevel;
  description: string;
  hasAuthorization: boolean;
}

export type SensitiveType =
  | 'personal_identity'
  | 'personal_contact'
  | 'financial'
  | 'health_medical'
  | 'biometric'
  | 'location'
  | 'government_id'
  | 'education'
  | 'employment'
  | 'other';

export interface UpdateFrequencyResult {
  score: number;
  maxScore: number;
  currentFrequency: UpdateFrequencyType;
  isSpecified: boolean;
  hasLastUpdated: boolean;
  daysSinceLastUpdate?: number;
}

export interface DescriptionCompletenessResult {
  score: number;
  maxScore: number;
  providedFields: string[];
  missingFields: string[];
}

export interface AuthorizationResult {
  score: number;
  maxScore: number;
  hasPurpose: boolean;
  hasRetention: boolean;
  scopeCoverage: number;
}

export interface RiskItem {
  id: string;
  category: string;
  level: RiskLevel;
  message: string;
  suggestion: string;
  relatedFields?: string[];
}

export interface DetailLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  module: string;
  message: string;
  data?: any;
}

export interface ScoringResult {
  productId: string;
  totalScore: number;
  maxScore: number;
  grade: QualityGrade;
  dimensionScores: {
    fieldCompleteness: FieldCompletenessResult;
    sampleCompleteness: SampleCompletenessResult;
    sensitiveField: SensitiveFieldResult;
    updateFrequency: UpdateFrequencyResult;
    descriptionCompleteness: DescriptionCompletenessResult;
    authorization: AuthorizationResult;
  };
  risks: RiskItem[];
  suggestions: string[];
  detailLogs?: DetailLogEntry[];
  metadata: {
    scoredAt: string;
    industry: IndustryType;
    weights: ScoringWeights;
  };
}

export interface BatchScoringResult {
  results: ScoringResult[];
  summary: {
    totalItems: number;
    gradeDistribution: Record<QualityGrade, number>;
    averageScore: number;
  };
}

export interface IndustryRequiredFieldsConfig {
  required: string[];
  recommended: string[];
  description: string;
}

export interface SDKOptions {
  defaultIndustry?: IndustryType;
  defaultWeights?: Partial<ScoringWeights>;
  enableDetailLogByDefault?: boolean;
  customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;
  customSensitiveFieldPatterns?: Array<{
    pattern: RegExp;
    type: SensitiveType;
    level: DataSensitivityLevel;
    description: string;
  }>;
}
