import DataQualitySDK, {
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  IndustryType,
  IndustryRequiredFieldsConfig,
} from './index';

const customFinanceConfig: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '自定义金融行业规则 (v2.0)',
  required: ['transactionId', 'userId', 'transactionAmount', 'transactionTime', 'accountNumber', 'currency'],
  recommended: ['phoneNumber', 'userName'],
};

const sdk = new DataQualitySDK({
  defaultIndustry: 'finance',
  enableDetailLogByDefault: false,
  autoNormalizeWeights: true,
  customIndustryConfigs: {
    finance: customFinanceConfig,
  },
  defaultWeights: {
    fieldCompleteness: 25,
    sampleCompleteness: 25,
    sensitiveField: 20,
    updateFrequency: 10,
    descriptionCompleteness: 10,
    authorization: 10,
  },
});

const description: DataProductDescription = {
  productId: 'PROD-001',
  productName: '用户交易行为数据集',
  description: '包含用户近一年的交易记录，涵盖消费、转账、理财等多种交易类型，适用于风控建模和用户画像分析',
  dataSource: '核心交易系统',
  coveragePeriod: {
    start: '2024-01-01',
    end: '2024-12-31',
  },
  updateFrequency: 'daily',
  lastUpdatedAt: '2025-01-10T08:00:00Z',
};

const fields: FieldDefinition[] = [
  { name: 'id', type: 'string', description: '记录唯一标识', nullable: false },
  { name: 'userId', type: 'string', description: '用户ID', nullable: false },
  { name: 'accountId', type: 'string', description: '账户ID', nullable: false },
  { name: 'accountNumber', type: 'string', description: '资金账号', nullable: false },
  { name: 'phoneNumber', type: 'string', description: '联系手机号', nullable: true },
  { name: 'userName', type: 'string', description: '用户姓名', nullable: true },
  { name: 'transactionAmount', type: 'number', description: '交易金额', nullable: false },
  { name: 'transactionTime', type: 'date', description: '交易时间', nullable: false },
  { name: 'currency', type: 'string', description: '币种', nullable: false },
  { name: 'merchantName', type: 'string', description: '商户名称', nullable: true },
  { name: 'transactionType', type: 'string', description: '交易类型' },
  { name: 'cardNo', type: 'string', description: '银行卡号后四位' },
  { name: 'createdAt', type: 'date', description: '记录创建时间' },
  { name: 'status', type: 'string', description: '交易状态' },
  { name: 'remark', type: 'string', nullable: true },
];

const sample: SampleSummary = {
  totalRecords: 5000,
  fieldValues: {
    id: { nonNullCount: 5000, uniqueCount: 5000, nullCount: 0 },
    userId: { nonNullCount: 5000, uniqueCount: 1200, nullCount: 0 },
    accountId: { nonNullCount: 5000, uniqueCount: 1500, nullCount: 0 },
    accountNumber: { nonNullCount: 4950, uniqueCount: 1500, nullCount: 50 },
    phoneNumber: { nonNullCount: 4200, nullCount: 800 },
    userName: { nonNullCount: 3500, nullCount: 1500 },
    transactionAmount: { nonNullCount: 4980, minValue: 0.01, maxValue: 500000, nullCount: 20 },
    transactionTime: { nonNullCount: 5000, nullCount: 0 },
    currency: { nonNullCount: 5000, uniqueCount: 3, nullCount: 0 },
    merchantName: { nonNullCount: 4200, nullCount: 800 },
    transactionType: { nonNullCount: 5000, uniqueCount: 8, nullCount: 0 },
    cardNo: { nonNullCount: 4900, nullCount: 100 },
    createdAt: { nonNullCount: 5000, nullCount: 0 },
    status: { nonNullCount: 5000, uniqueCount: 4, nullCount: 0 },
    remark: { nonNullCount: 1500, nullCount: 3500 },
  },
};

const authorization: AuthorizationScope = {
  allowedPurposes: ['数据分析', '风控评估', '用户画像'],
  allowedRecipients: ['风控部门', '数据分析团队'],
  retentionPeriod: '3年',
  dataProcessingRegions: ['中国大陆'],
};

console.log('========================================');
console.log('     数据要素质量评分 SDK 综合示例');
console.log('========================================\n');

console.log('=== 示例 1: 基础评分 + 自定义行业配置 ===\n');
const result1 = sdk.score({
  productId: 'PROD-001',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  enableDetailLog: false,
});

console.log(`行业规则版本: ${result1.metadata.industryConfigVersion}`);
console.log(`行业规则说明: ${result1.metadata.industryConfigDescription}`);
console.log(`综合得分: ${result1.totalScore} / ${result1.maxScore} (${Math.round(result1.totalScore / result1.maxScore * 100)}%)`);
console.log(`质量等级: ${result1.grade}`);
console.log(`风险项数量: ${result1.risks.length}\n`);

console.log('--- 风险项及证据来源 ---');
for (const risk of result1.risks) {
  console.log(`  [${risk.level.toUpperCase()}] ${risk.message}`);
  console.log(`      建议: ${risk.suggestion}`);
  if (risk.relatedFields && risk.relatedFields.length > 0) {
    console.log(`      相关字段: ${risk.relatedFields.join(', ')}`);
  }
  if (risk.evidence && risk.evidence.length > 0) {
    console.log(`      📋 证据来源:`);
    for (const ev of risk.evidence) {
      const evValue = ev.value !== undefined ? ` → ${ev.value}` : '';
      const evFields = ev.fields && ev.fields.length > 0 ? ` [字段: ${ev.fields.join(', ')}]` : '';
      console.log(`         • ${ev.description}${evValue}${evFields}`);
    }
  }
  console.log('');
}

console.log('=== 示例 2: 非法日期检测 + 权重异常归一化 ===\n');
const badDescription: DataProductDescription = {
  ...description,
  lastUpdatedAt: 'not-a-valid-date-!!!',
};

const badWeights = {
  fieldCompleteness: -5,
  sampleCompleteness: 0,
  sensitiveField: NaN as any,
  updateFrequency: 30,
  descriptionCompleteness: 20,
  authorization: 10,
};

const result2 = sdk.score({
  productId: 'PROD-BAD',
  description: badDescription,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  customWeights: badWeights,
  enableDetailLog: false,
});

console.log(`综合得分: ${result2.totalScore} / ${result2.maxScore}`);
console.log(`质量等级: ${result2.grade}`);
console.log(`权重是否被自动归一化: ${result2.metadata.weightsNormalized ? '是' : '否'}`);
if (result2.weightWarnings) {
  console.log('权重警告:');
  for (const w of result2.weightWarnings) {
    console.log(`  ⚠️  ${w}`);
  }
}
if (result2.metadata.originalWeights) {
  console.log(`原始权重: ${JSON.stringify(result2.metadata.originalWeights)}`);
}
console.log(`归一化后权重: ${JSON.stringify(result2.metadata.weights)}`);

console.log('\n--- 更新频率检测结果 ---');
console.log(`lastUpdatedAt 原始值: "${result2.dimensionScores.updateFrequency.lastUpdatedRawValue}"`);
console.log(`是否为非法日期: ${result2.dimensionScores.updateFrequency.hasInvalidLastUpdated ? '是' : '否'}`);

const invalidRisk = result2.risks.find((r) => r.id === 'update-invalid-date');
if (invalidRisk) {
  console.log(`\n非法日期风险项:`);
  console.log(`  [${invalidRisk.level.toUpperCase()}] ${invalidRisk.message}`);
  if (invalidRisk.evidence && invalidRisk.evidence.length > 0) {
    console.log(`  📋 证据来源:`);
    for (const ev of invalidRisk.evidence) {
      console.log(`     • ${ev.description}: ${ev.value}`);
    }
  }
}

console.log('\n=== 示例 3: 新增敏感字段识别 (phoneNumber、accountNumber、userName) ===\n');
const sensitiveFields = result1.dimensionScores.sensitiveField.sensitiveFields;
console.log(`检测到 ${sensitiveFields.length} 个敏感字段:`);
for (const sf of sensitiveFields) {
  console.log(`  🔒 ${sf.fieldName} - ${sf.description} (级别:${sf.sensitivityLevel}, 已授权:${sf.hasAuthorization ? '是' : '否'})`);
  if (sf.matchedPattern) {
    console.log(`     匹配模式: ${sf.matchedPattern}`);
  }
}

console.log('\n=== 示例 4: 完整文本报告（含证据来源）===\n');
const textReport = sdk.generateTextReport(result1, {
  includeDetails: true,
  includeRisks: true,
  includeEvidence: true,
  includeWeights: true,
  includeLogs: false,
});
console.log(textReport);

console.log('\n=== 示例 5: 批量评分汇总报告（含高频风险和低分维度）===\n');

const description3: DataProductDescription = {
  productId: 'PROD-003',
  productName: '残缺用户数据集',
  description: '字段缺失严重，用于测试低分场景',
  lastUpdatedAt: 'invalid-date-here',
};

const fields3: FieldDefinition[] = [
  { name: 'id', type: 'string' },
  { name: 'phoneNumber', type: 'string', description: '手机号' },
  { name: 'userName', type: 'string', description: '用户姓名' },
];

const sample3: SampleSummary = {
  totalRecords: 100,
  fieldValues: {
    id: { nonNullCount: 50, nullCount: 50 },
    phoneNumber: { nonNullCount: 30, nullCount: 70 },
    userName: { nonNullCount: 40, nullCount: 60 },
  },
};

const auth3: AuthorizationScope = {
  allowedPurposes: ['仅内部使用'],
};

const batchResult = sdk.scoreBatch({
  items: [
    {
      productId: 'PROD-001',
      description,
      fields,
      sample,
      authorization,
      industry: 'finance' as IndustryType,
    },
    {
      productId: 'PROD-002',
      description: { ...description, productId: 'PROD-002', productName: '用户基础信息' },
      fields: fields.slice(0, 8),
      sample: { ...sample, totalRecords: 100 },
      authorization: { allowedPurposes: ['用户服务'] },
      industry: 'retail' as IndustryType,
    },
    {
      productId: 'PROD-003',
      description: description3,
      fields: fields3,
      sample: sample3,
      authorization: auth3,
      industry: 'finance' as IndustryType,
    },
  ],
});

console.log(`批量评分完成，共 ${batchResult.summary.totalItems} 个产品`);
console.log(`平均得分率: ${Math.round(batchResult.summary.averageScore * 100)}%`);
console.log('等级分布:');
for (const [grade, count] of Object.entries(batchResult.summary.gradeDistribution)) {
  if (count > 0) {
    console.log(`  ${grade}: ${count} 个`);
  }
}

if (batchResult.summary.highFrequencyRisks.length > 0) {
  console.log('\n🔥 高频风险 TOP 10:');
  for (const r of batchResult.summary.highFrequencyRisks) {
    const pct = Math.round(r.occurrenceCount / batchResult.summary.totalItems * 100);
    console.log(`  [${r.level.toUpperCase()}] ${r.message} — ${r.occurrenceCount}/${batchResult.summary.totalItems} (${pct}%)`);
    console.log(`    影响产品: ${r.affectedProducts.join(', ')}`);
  }
}

if (batchResult.summary.lowScoringDimensions.length > 0) {
  console.log('\n⚠️  低分维度分析 (< 60%):');
  for (const d of batchResult.summary.lowScoringDimensions) {
    const pct = Math.round(d.belowThresholdCount / batchResult.summary.totalItems * 100);
    console.log(`  📉 ${d.dimension}: 平均分 ${d.averageScore}%，${d.belowThresholdCount}/${batchResult.summary.totalItems} (${pct}%) 产品低于 60 分`);
    console.log(`    低分产品: ${d.affectedProducts.join(', ')}`);
  }
}

console.log('\n' + sdk.generateBatchSummaryReport(batchResult));
