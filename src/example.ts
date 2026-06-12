import DataQualitySDK, {
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  IndustryType,
} from './index';

const sdk = new DataQualitySDK({
  defaultIndustry: 'finance',
  enableDetailLogByDefault: false,
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
  { name: 'transactionAmount', type: 'number', description: '交易金额', nullable: false },
  { name: 'transactionTime', type: 'date', description: '交易时间', nullable: false },
  { name: 'currency', type: 'string', description: '币种', nullable: false },
  { name: 'name', type: 'string', description: '用户姓名', nullable: true },
  { name: 'phone', type: 'string', description: '手机号', nullable: true },
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
    transactionAmount: { nonNullCount: 4980, minValue: 0.01, maxValue: 500000, nullCount: 20 },
    transactionTime: { nonNullCount: 5000, nullCount: 0 },
    currency: { nonNullCount: 5000, uniqueCount: 3, nullCount: 0 },
    name: { nonNullCount: 3500, nullCount: 1500 },
    phone: { nonNullCount: 4800, nullCount: 200 },
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

console.log('=== 单个产品评分示例 ===\n');

const result = sdk.score({
  productId: 'PROD-001',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  enableDetailLog: false,
});

console.log(`综合得分: ${result.totalScore} / ${result.maxScore}`);
console.log(`质量等级: ${result.grade}`);
console.log(`风险项数量: ${result.risks.length}`);
console.log('');

console.log('--- 各维度得分 ---');
console.log(`字段完整性: ${result.dimensionScores.fieldCompleteness.score}/100`);
console.log(`样本完整性: ${result.dimensionScores.sampleCompleteness.score}/100`);
console.log(`敏感字段: ${result.dimensionScores.sensitiveField.score}/100`);
console.log(`更新频率: ${result.dimensionScores.updateFrequency.score}/100`);
console.log(`描述完整性: ${result.dimensionScores.descriptionCompleteness.score}/100`);
console.log(`授权范围: ${result.dimensionScores.authorization.score}/100`);
console.log('');

console.log('--- 风险项 ---');
for (const risk of result.risks) {
  console.log(`[${risk.level.toUpperCase()}] ${risk.message}`);
  console.log(`    建议: ${risk.suggestion}`);
  if (risk.relatedFields) {
    console.log(`    字段: ${risk.relatedFields.join(', ')}`);
  }
}
console.log('');

console.log('--- 改进建议 ---');
for (const suggestion of result.suggestions) {
  console.log(`  • ${suggestion}`);
}
console.log('');

console.log('=== 文本报告示例 ===\n');
const textReport = sdk.generateTextReport(result, {
  includeDetails: true,
  includeLogs: false,
});
console.log(textReport);
console.log('');

console.log('=== 批量评分示例 ===\n');

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
  ],
});

console.log(`批量评分完成，共 ${batchResult.summary.totalItems} 个产品`);
console.log(`平均得分: ${Math.round(batchResult.summary.averageScore * 100) / 100}`);
console.log('等级分布:');
for (const [grade, count] of Object.entries(batchResult.summary.gradeDistribution)) {
  if (count > 0) {
    console.log(`  ${grade}: ${count} 个`);
  }
}

const batchReport = sdk.generateBatchSummaryReport(batchResult);
console.log('\n' + batchReport);
