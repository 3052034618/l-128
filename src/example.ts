import DataQualitySDK, {
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  IndustryType,
  IndustryRequiredFieldsConfig,
  IndustryRuleRegistry,
  ScoringResult,
} from './index';

const registry = IndustryRuleRegistry.getInstance();
registry.reset();

console.log('========================================');
console.log('     数据要素质量评分 SDK v3.0 综合示例');
console.log('========================================\n');

const financeV1: IndustryRequiredFieldsConfig = {
  version: 'v1.0',
  description: '金融行业规则 v1.0 - 基础版',
  required: ['userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency'],
  recommended: ['merchantName', 'transactionType', 'riskLevel'],
};

const financeV2: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '金融行业规则 v2.0 - 加强版',
  required: ['transactionId', 'userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency', 'accountNumber'],
  recommended: ['phoneNumber', 'userName', 'merchantName'],
};

const financeV3: IndustryRequiredFieldsConfig = {
  version: 'v3.0',
  description: '金融行业规则 v3.0 - 严格版（已废弃）',
  required: ['transactionId', 'userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency', 'accountNumber', 'riskLevel'],
  recommended: ['phoneNumber', 'userName', 'merchantName', 'cardType'],
  deprecatedAt: '2025-06-01',
};

const retailV1: IndustryRequiredFieldsConfig = {
  version: 'v1.0',
  description: '零售行业规则 v1.0',
  required: ['orderId', 'productId', 'quantity', 'price', 'orderTime'],
  recommended: ['customerId', 'paymentMethod'],
};

if (registry.hasRule('finance', 'v1.0')) registry.removeRule('finance', 'v1.0');
if (registry.hasRule('retail', 'v1.0')) registry.removeRule('retail', 'v1.0');

registry.registerRule('finance', 'v1.0', financeV1, { setAsDefault: true });
registry.registerRule('finance', 'v2.0', financeV2);
registry.registerRule('finance', 'v3.0', financeV3);
registry.registerRule('retail', 'v1.0', retailV1, { setAsDefault: true });

console.log('=== 已注册规则清单 ===');
console.log('金融行业版本:', registry.listVersions('finance'));
console.log('金融默认版本:', registry.getDefaultVersion('finance'));
console.log('零售行业版本:', registry.listVersions('retail'));
console.log('所有行业:', registry.listIndustries());
console.log('');

const sdk = new DataQualitySDK({
  defaultIndustry: 'finance',
  enableDetailLogByDefault: false,
  autoNormalizeWeights: true,
  handleZeroWeightAs: 'warn',
  auditPassThreshold: 70,
});

console.log('=== SDK 配置 ===');
console.log('零权重处理策略: warn（返回警告，说明不计分');
console.log('审核通过阈值: 70分');
console.log('');

const description: DataProductDescription = {
  productId: 'PROD-001',
  productName: '用户交易行为数据集',
  description: '包含用户近一年的交易记录，涵盖消费、转账、理财等多种交易类型',
  dataSource: '核心交易系统',
  coveragePeriod: { start: '2024-01-01', end: '2024-12-31' },
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

console.log('\n=== 示例 1: 按指定版本评分 + 规则回退测试 ===\n');

console.log('--- 1.1 使用 v2.0 版本规则评分（指定存在的版本 ---');
const resultV2 = sdk.score({
  productId: 'PROD-001',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

console.log(`规则版本: ${resultV2.metadata.industryConfigVersion}`);
console.log(`规则说明: ${resultV2.metadata.industryConfigDescription}`);
console.log(`规则来源: ${resultV2.metadata.industryConfigSource}`);
console.log(`综合得分: ${resultV2.totalScore} / ${resultV2.maxScore} (${Math.round(resultV2.totalScore / resultV2.maxScore * 100)}%)`);
console.log(`质量等级: ${resultV2.grade}`);
console.log(`规则回退信息: ${resultV2.ruleFallbackInfo ? JSON.stringify(resultV2.ruleFallbackInfo) : '无回退（命中指定版本）'}`);
console.log('');

console.log('--- 1.2 请求不存在的版本 v9.9（触发回退到默认版本 ---');
const resultFallback = sdk.score({
  productId: 'PROD-001',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v9.9',
});

console.log(`请求版本: v9.9`);
console.log(`实际使用版本: ${resultFallback.metadata.industryConfigVersion}`);
console.log(`规则来源: ${resultFallback.metadata.industryConfigSource}`);
console.log(`回退原因: ${resultFallback.metadata.ruleFallbackReason || '无'}`);
if (resultFallback.ruleFallbackInfo) {
  console.log(`回退详情:`, JSON.stringify(resultFallback.ruleFallbackInfo));
}
console.log('');

console.log('--- 1.3 请求不存在的行业 healthcare（未注册，触发回退到默认行业 finance）---');
const resultIndustryFallback = sdk.score({
  productId: 'PROD-001',
  description,
  fields,
  sample,
  authorization,
  industry: 'healthcare' as IndustryType,
});

console.log(`请求行业: healthcare`);
console.log(`实际使用行业: ${resultIndustryFallback.metadata.industry}`);
console.log(`回退原因: ${resultIndustryFallback.metadata.ruleFallbackReason || '无'}`);
console.log('');

console.log('\n=== 示例 2: 零权重策略演示 ===\n');

console.log('--- 2.1 handleZeroWeightAs: "warn" - 返回警告，该维度不计入总分 ---');
const zeroWeightsWarn = {
  fieldCompleteness: 25,
  sampleCompleteness: 25,
  sensitiveField: 0,
  updateFrequency: 20,
  descriptionCompleteness: 15,
  authorization: 15,
};

const sdkWarn = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  handleZeroWeightAs: 'warn',
});

const resultWarn = sdkWarn.score({
  productId: 'PROD-ZERO-WARN',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  customWeights: zeroWeightsWarn,
});

console.log(`综合得分: ${resultWarn.totalScore} / ${resultWarn.maxScore}`);
console.log(`质量等级: ${resultWarn.grade}`);
if (resultWarn.zeroWeightDimensions && resultWarn.zeroWeightDimensions.length > 0) {
  console.log('\n零权重维度:');
  for (const zw of resultWarn.zeroWeightDimensions) {
    console.log(`  ⚠️  ${zw.dimensionName} (${zw.dimensionKey}): ${zw.note}`);
    console.log(`     处理策略: ${zw.handlingStrategy}`);
  }
}
if (resultWarn.weightWarnings) {
  console.log('\n权重警告:');
  for (const w of resultWarn.weightWarnings) {
    console.log(`  ⚠️  ${w}`);
  }
}
console.log('');

console.log('--- 2.2 handleZeroWeightAs: "exclude" - 自动排除不计分，其他维度权重归一化 ---');
const zeroWeightsExclude = {
  fieldCompleteness: 0,
  sampleCompleteness: 25,
  sensitiveField: 0,
  updateFrequency: 20,
  descriptionCompleteness: 15,
  authorization: 15,
};

const sdkExclude = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  handleZeroWeightAs: 'exclude',
});

const resultExclude = sdkExclude.score({
  productId: 'PROD-ZERO-EXCLUDE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  customWeights: zeroWeightsExclude,
});

console.log(`综合得分: ${resultExclude.totalScore} / ${resultExclude.maxScore}`);
console.log(`质量等级: ${resultExclude.grade}`);
if (resultExclude.zeroWeightDimensions && resultExclude.zeroWeightDimensions.length > 0) {
  console.log('\n零权重维度（已排除，不计入总分）:');
  for (const zw of resultExclude.zeroWeightDimensions) {
    console.log(`  🚫 ${zw.dimensionName}: ${zw.note}`);
  }
}
console.log(`归一化后权重总和: ${Object.values(resultExclude.metadata.weights).reduce((a, b) => a + b, 0)}`);
console.log('');

console.log('--- 2.3 handleZeroWeightAs: "normalize" - 按 0 参与归一化，权重自动缩放 ---');
const zeroWeightsNormalize = {
  fieldCompleteness: 0,
  sampleCompleteness: 25,
  sensitiveField: 0,
  updateFrequency: 20,
  descriptionCompleteness: 15,
  authorization: 15,
};

const sdkNormalize = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  handleZeroWeightAs: 'normalize',
});

const resultNormalize = sdkNormalize.score({
  productId: 'PROD-ZERO-NORM',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  customWeights: zeroWeightsNormalize,
});

console.log(`综合得分: ${resultNormalize.totalScore} / ${resultNormalize.maxScore}`);
console.log(`质量等级: ${resultNormalize.grade}`);
console.log(`归一化后权重:`, JSON.stringify(resultNormalize.metadata.weights));
console.log(`权重总和: ${Object.values(resultNormalize.metadata.weights).reduce((a, b) => a + b, 0)}`);
console.log('');

console.log('\n=== 示例 3: 上架审核摘要报告 ===\n');

const auditResult = sdk.score({
  productId: 'PROD-AUDIT',
  description: { ...description, lastUpdatedAt: 'invalid-date' },
  fields: fields.slice(0, 6),
  sample: { ...sample, totalRecords: 100 },
  authorization: { allowedPurposes: ['仅内部使用'] },
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

console.log('--- 3.1 结构化审核报告（JSON）---');
const auditReport = sdk.generateAuditSummaryReport(auditResult);
console.log(`审核结果: ${auditReport.overallResult}`);
console.log(`综合得分: ${auditReport.totalScore} / ${auditReport.maxScore}`);
console.log(`通过阈值: ${auditReport.passThreshold}分`);
console.log(`质量等级: ${auditReport.grade}`);

if (auditReport.criticalFailures.length > 0) {
  console.log(`\n❌ 致命不通过项 (${auditReport.criticalFailures.length}项):`);
  for (const r of auditReport.criticalFailures) {
    console.log(`  [CRITICAL] ${r.message}`);
  }
}
if (auditReport.highPriorityRisks.length > 0) {
  console.log(`\n⚠️  高优先级风险 (${auditReport.highPriorityRisks.length}项):`);
  for (const r of auditReport.highPriorityRisks) {
    console.log(`  [HIGH] ${r.message}`);
  }
}
if (auditReport.rectificationPlan.length > 0) {
  console.log(`\n📋 整改计划 (${auditReport.rectificationPlan.length}项):`);
  for (const plan of auditReport.rectificationPlan) {
    console.log(`  [${plan.priority.toUpperCase()}] ${plan.action}`);
    console.log(`     预期效果: ${plan.expectedImpact}`);
  }
}
console.log(`\n📜 规则信息: ${auditReport.ruleInfo.industry} / ${auditReport.ruleInfo.version} - ${auditReport.ruleInfo.description}`);
console.log('');

console.log('--- 3.2 审核摘要（Markdown格式，可直接贴审核单）---');
const auditMarkdown = sdk.generateAuditSummaryText(auditResult, 'markdown');
console.log(auditMarkdown);
console.log('');

console.log('\n=== 示例 4: Markdown 报告导出 ===\n');
const markdownReport = sdk.generateMarkdownReport(resultV2, {
  includeDetails: true,
  includeRisks: true,
  includeEvidence: true,
  includeWeights: true,
});
console.log(markdownReport);
console.log('');

console.log('\n=== 示例 5: 批量评分 - 多维度分组汇总 ===\n');

const batchItems = [
  {
    productId: 'PROD-BATCH-001',
    description,
    fields,
    sample,
    authorization,
    industry: 'finance' as IndustryType,
    industryConfigVersion: 'v1.0',
  },
  {
    productId: 'PROD-BATCH-002',
    description: { ...description, productId: 'PROD-BATCH-002', productName: '零售订单数据' },
    fields: fields.slice(0, 8),
    sample: { ...sample, totalRecords: 1000 },
    authorization: { allowedPurposes: ['用户服务'] },
    industry: 'retail' as IndustryType,
  },
  {
    productId: 'PROD-BATCH-003',
    description: { ...description, productId: 'PROD-BATCH-003', lastUpdatedAt: 'invalid-date' },
    fields: fields.slice(0, 5),
    sample: { ...sample, totalRecords: 500 },
    authorization: { allowedPurposes: ['内部测试'] },
    industry: 'finance' as IndustryType,
    industryConfigVersion: 'v2.0',
  },
  {
    productId: 'PROD-BATCH-004',
    description: { ...description, productId: 'PROD-BATCH-004' },
    fields: fields.slice(0, 3),
    sample: { ...sample, totalRecords: 100 },
    authorization: { allowedPurposes: ['仅内部使用'] },
    industry: 'finance' as IndustryType,
  },
  {
    productId: 'PROD-BATCH-005',
    description: { ...description, productId: 'PROD-BATCH-005', productName: '零售会员数据' },
    fields: fields.slice(0, 10),
    sample: { ...sample, totalRecords: 2000 },
    authorization,
    industry: 'retail' as IndustryType,
  },
];

const batchResult = sdk.scoreBatch({ items: batchItems });

console.log(`批量评分完成，共 ${batchResult.summary.totalItems} 个产品`);
console.log(`平均得分率: ${Math.round(batchResult.summary.averageScore * 100)}%`);
console.log('等级分布:');
for (const [grade, count] of Object.entries(batchResult.summary.gradeDistribution)) {
  if (count > 0) console.log(`  ${grade}: ${count} 个`);
}

console.log('\n🔥 高频风险（按实际占比统计):');
for (const r of batchResult.summary.highFrequencyRisks) {
  console.log(`  [${r.level.toUpperCase()}] ${r.message} — ${r.occurrenceCount}/${batchResult.summary.totalItems} (${r.occurrencePercentage}%)`);
}

if (batchResult.summary.groupByIndustry && batchResult.summary.groupByIndustry.length > 0) {
  console.log('\n📊 按行业分组汇总:');
  for (const group of batchResult.summary.groupByIndustry) {
    console.log(`\n  【${group.groupName}】 ${group.totalItems} 个产品，平均分: ${group.averageScore}%`);
    console.log(`    等级分布: S=${group.gradeDistribution.S}, A=${group.gradeDistribution.A}, B=${group.gradeDistribution.B}, C=${group.gradeDistribution.C}, D=${group.gradeDistribution.D}`);
    group.highFrequencyRisks.slice(0, 3).forEach((r: { message: string; occurrencePercentage: number }) => {
      console.log(`    🔴 ${r.message} (${r.occurrencePercentage}%)`);
    });
  }
}

if (batchResult.summary.groupByGrade && batchResult.summary.groupByGrade.length > 0) {
  console.log('\n📈 按等级分组汇总:');
  for (const group of batchResult.summary.groupByGrade) {
    console.log(`  【${group.groupName}】 ${group.totalItems} 个产品`);
    console.log(`    产品列表: ${group.productIds.join(', ')}`);
  }
}

if (batchResult.summary.groupByCategory && batchResult.summary.groupByCategory.length > 0) {
  console.log('\n🏷️  按风险类别分组汇总:');
  for (const group of batchResult.summary.groupByCategory) {
    console.log(`  【${group.groupName}】 ${group.totalItems} 个产品，平均分: ${group.averageScore}%`);
    console.log(`    产品列表: ${group.productIds.join(', ')}`);
  }
}

console.log('\n' + sdk.generateBatchSummaryReport(batchResult, 'markdown'));
console.log('');

console.log('\n=== 示例 6: 评分结果对比能力 ===\n');

console.log('--- 6.1 同一产品，不同规则版本对比（v1.0 vs v2.0 ---');
const resultV1 = sdk.score({
  productId: 'PROD-COMPARE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v1.0',
});

const resultV2Compare = sdk.score({
  productId: 'PROD-COMPARE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

const comparison = sdk.compareScoringResults(resultV1, resultV2Compare, {
  labelA: '规则v1.0',
  labelB: '规则v2.0',
});

console.log(`产品: ${comparison.productId}`);
console.log(`总分变化: ${comparison.totalScoreA}% → ${comparison.totalScoreB}% (${comparison.totalScoreDiff > 0 ? '+' : ''}${comparison.totalScoreDiff}%)`);
console.log(`等级变化: ${comparison.gradeA} → ${comparison.gradeB}${comparison.gradeChanged ? '（已变化）' : '（未变化）'}`);
console.log('');

if (comparison.improvedDimensions.length > 0) {
  console.log(`✅ 改善维度 (${comparison.improvedDimensions.length}):`);
  for (const d of comparison.improvedDimensions) {
    console.log(`  ${d.dimension}: ${d.scoreA} → ${d.scoreB} (+${d.scoreDiff})`);
  }
}
if (comparison.worsenedDimensions.length > 0) {
  console.log(`\n❌ 恶化维度 (${comparison.worsenedDimensions.length}):`);
  for (const d of comparison.worsenedDimensions) {
    console.log(`  ${d.dimension}: ${d.scoreA} → ${d.scoreB} (${d.scoreDiff})`);
  }
}
if (comparison.newRisks.length > 0) {
  console.log(`\n🆕 新增风险 (${comparison.newRisks.length}):`);
  for (const r of comparison.newRisks) {
    console.log(`  [${r.levelB || 'unknown'}] ${r.message}`);
  }
}
if (comparison.resolvedRisks.length > 0) {
  console.log(`\n✅ 已解决风险 (${comparison.resolvedRisks.length}):`);
  for (const r of comparison.resolvedRisks) {
    console.log(`  [${r.levelA || 'unknown'}] ${r.message}`);
  }
}

console.log('\n--- 6.2 对比报告（Markdown格式）---');
const comparisonReport = sdk.generateComparisonReport(resultV1, resultV2Compare, {
  labelA: '规则v1.0',
  labelB: '规则v2.0',
  format: 'markdown',
});
console.log(comparisonReport);

console.log('\n=== 示例 7: 规则导入导出 ===\n');

const exported = registry.exportRules();
console.log(`导出规则总数: ${exported.length} 条`);
for (const rule of exported) {
  console.log(`  ${rule.industry} / ${rule.version} ${rule.isDefault ? '(默认)' : ''} - ${rule.description}`);
}
console.log('');

console.log('========================================');
console.log('           所有示例执行完成！');
console.log('========================================');
