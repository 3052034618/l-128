export type IndustryType =
  | 'finance'
  | 'healthcare'
  | 'education'
  | 'retail'
  | 'transportation'
  | 'government'
  | 'manufacturing'
  | 'general'
  | string;

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
  industryConfigVersion?: string;
}

export interface BatchScoringInput {
  items: ScoringInput[];
  globalOptions?: {
    customWeights?: Partial<ScoringWeights>;
    industry?: IndustryType;
    enableDetailLog?: boolean;
    industryConfigVersion?: string;
    autoNormalizeWeights?: boolean;
  };
  autoNormalizeWeights?: boolean;
}

export interface ScoringWeights {
  fieldCompleteness: number;
  sampleCompleteness: number;
  sensitiveField: number;
  updateFrequency: number;
  descriptionCompleteness: number;
  authorization: number;
}

export interface WeightValidationResult {
  isValid: boolean;
  normalizedWeights: ScoringWeights;
  warnings: string[];
  wasNormalized: boolean;
  originalSum: number;
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
  ruleVersion?: string;
  ruleDescription?: string;
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
  matchedPattern?: string;
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
  hasInvalidLastUpdated: boolean;
  daysSinceLastUpdate?: number;
  lastUpdatedRawValue?: string;
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

export interface RiskEvidence {
  type: 'field' | 'sample_rate' | 'date_check' | 'weight' | 'config' | 'count' | 'value';
  description: string;
  value?: any;
  expected?: any;
  fields?: string[];
}

export interface RiskItem {
  id: string;
  category: string;
  level: RiskLevel;
  message: string;
  suggestion: string;
  relatedFields?: string[];
  evidence?: RiskEvidence[];
}

export interface DetailLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  module: string;
  message: string;
  data?: any;
}

export interface LowScoringDimension {
  dimension: string;
  dimensionKey: keyof ScoringWeights;
  averageScore: number;
  belowThresholdCount: number;
  affectedProducts: string[];
}

export interface IndustryRequiredFieldsConfig {
  version?: string;
  required: string[];
  recommended: string[];
  description: string;
  isDefault?: boolean;
  effectiveAt?: string;
  deprecatedAt?: string;
  source?: 'built-in' | 'custom' | 'override';
}

export interface RegisteredIndustryConfig extends IndustryRequiredFieldsConfig {
  version: string;
  industry: string;
  registeredAt: string;
  isDefault: boolean;
  source: 'built-in' | 'custom' | 'override';
}

export interface RuleQueryResult {
  config: RegisteredIndustryConfig;
  isDefault: boolean;
  isLatest: boolean;
  fallbackReason?: string;
  availableVersions: string[];
}

export interface RuleFallbackInfo {
  requestedIndustry?: string;
  requestedVersion?: string;
  fallbackIndustry: string;
  fallbackVersion: string;
  reason: string;
}

export interface ZeroWeightDimension {
  dimensionKey: keyof ScoringWeights;
  dimensionName: string;
  isExplicitlyZero: boolean;
  handlingStrategy: 'exclude' | 'normalize';
  note: string;
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
  weightWarnings?: string[];
  zeroWeightDimensions?: ZeroWeightDimension[];
  ruleFallbackInfo?: RuleFallbackInfo;
  metadata: {
    scoredAt: string;
    industry: IndustryType;
    weights: ScoringWeights;
    originalWeights?: ScoringWeights;
    weightsNormalized: boolean;
    industryConfigVersion?: string;
    industryConfigDescription?: string;
    industryConfigSource?: 'built-in' | 'custom' | 'override';
    ruleFallbackReason?: string;
  };
}

export interface HighFrequencyRisk {
  id: string;
  message: string;
  level: RiskLevel;
  category: string;
  occurrenceCount: number;
  occurrencePercentage: number;
  affectedProducts: string[];
}

export interface BatchGroupSummary {
  groupKey: string;
  groupName: string;
  totalItems: number;
  averageScore: number;
  gradeDistribution: Record<QualityGrade, number>;
  highFrequencyRisks: HighFrequencyRisk[];
  lowScoringDimensions: LowScoringDimension[];
  productIds: string[];
}

export interface BatchScoringResult {
  results: ScoringResult[];
  summary: {
    totalItems: number;
    gradeDistribution: Record<QualityGrade, number>;
    averageScore: number;
    highFrequencyRisks: HighFrequencyRisk[];
    lowScoringDimensions: LowScoringDimension[];
    groupByIndustry?: BatchGroupSummary[];
    groupByGrade?: BatchGroupSummary[];
    groupByCategory?: BatchGroupSummary[];
  };
}

export interface AuditSummaryReport {
  productId: string;
  productName?: string;
  scoredAt: string;
  overallResult: 'PASS' | 'FAIL' | 'WARNING';
  totalScore: number;
  maxScore: number;
  grade: QualityGrade;
  passThreshold: number;
  criticalFailures: RiskItem[];
  highPriorityRisks: RiskItem[];
  mediumPriorityRisks: RiskItem[];
  keyEvidence: {
    description: string;
    evidence: RiskEvidence[];
  }[];
  rectificationPlan: {
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    relatedRisks: string[];
    expectedImpact: string;
  }[];
  ruleInfo: {
    industry: string;
    version: string;
    description: string;
    source: string;
    fallbackInfo?: RuleFallbackInfo;
  };
}

export interface ScoreComparisonDelta {
  dimension: string;
  dimensionKey: keyof ScoringWeights;
  scoreA: number;
  scoreB: number;
  scoreDiff: number;
  maxScore: number;
}

export interface RiskComparisonDelta {
  riskId: string;
  category: string;
  message: string;
  inA: boolean;
  inB: boolean;
  levelA?: RiskLevel;
  levelB?: RiskLevel;
  levelChange?: 'up' | 'down' | 'same';
}

export interface ScoringComparisonResult {
  productId: string;
  labelA: string;
  labelB: string;
  totalScoreA: number;
  totalScoreB: number;
  totalScoreDiff: number;
  gradeA: QualityGrade;
  gradeB: QualityGrade;
  gradeChanged: boolean;
  dimensionDeltas: ScoreComparisonDelta[];
  improvedDimensions: ScoreComparisonDelta[];
  worsenedDimensions: ScoreComparisonDelta[];
  unchangedDimensions: ScoreComparisonDelta[];
  riskDeltas: RiskComparisonDelta[];
  newRisks: RiskComparisonDelta[];
  resolvedRisks: RiskComparisonDelta[];
  levelIncreasedRisks: RiskComparisonDelta[];
  levelDecreasedRisks: RiskComparisonDelta[];
  lowScoringDimensionsA: LowScoringDimension[];
  lowScoringDimensionsB: LowScoringDimension[];
  weightsA: ScoringWeights;
  weightsB: ScoringWeights;
  ruleInfoA: { industry: string; version: string; description: string };
  ruleInfoB: { industry: string; version: string; description: string };
  scoredAt: string;
}

export interface ComparisonOptions {
  labelA?: string;
  labelB?: string;
  lowScoreThreshold?: number;
}

export interface SDKOptions {
  defaultIndustry?: IndustryType;
  defaultWeights?: Partial<ScoringWeights>;
  enableDetailLogByDefault?: boolean;
  autoNormalizeWeights?: boolean;
  handleZeroWeightAs?: 'exclude' | 'normalize' | 'warn';
  customIndustryConfigs?: Record<string, IndustryRequiredFieldsConfig>;
  customSensitiveFieldPatterns?: Array<{
    pattern: RegExp;
    type: SensitiveType;
    level: DataSensitivityLevel;
    description: string;
  }>;
  defaultIndustryConfigVersion?: string;
  auditPassThreshold?: number;
}
