import DataQualitySDK, {
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  IndustryType,
  IndustryRequiredFieldsConfig,
  IndustryRuleRegistry,
  ScoringResult,
  RuleStatus,
} from './index';

const registry = IndustryRuleRegistry.getInstance();
registry.reset();

console.log('========================================');
console.log('  数据要素质量评分 SDK v4.0 综合示例');
console.log('  规则运营 & 审核交付能力');
console.log('========================================\n');

// ============================================================
// 示例 1: 规则状态管理（草稿 → 试运行 → 发布 → 停用）
// ============================================================
console.log('=== 示例 1: 规则状态生命周期管理 ===\n');

const financeV2Config: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '金融行业规则 v2.0 - 草稿版',
  required: ['transactionId', 'userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency'],
  recommended: ['merchantName', 'transactionType'],
};

// 先删除可能存在的冲突版本
if (registry.hasRule('finance', 'v2.0')) registry.removeRule('finance', 'v2.0');

registry.registerRule('finance', 'v2.0', financeV2Config, { initialStatus: 'draft' });
console.log('✅ 注册 v2.0（草稿状态）');
console.log('   可用版本 (published only):', registry.listVersions('finance', 'published'));
console.log('   全部版本:', registry.listVersions('finance'));

// 进入试运行
registry.startTrial('finance', 'v2.0', { remark: '开始灰度试运行', trialEndAt: '2025-07-01' });
registry.updateRule('finance', 'v2.0', {
  description: '金融行业规则 v2.0 - 试运行版',
  required: ['transactionId', 'userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency', 'accountNumber'],
  recommended: ['phoneNumber', 'userName', 'merchantName'],
  changeLog: '试运行更新：新增 accountNumber 为必填字段，增加手机号和用户名为推荐字段',
});
console.log('\n🚀 v2.0 进入试运行状态');
console.log('   试运行版本:', registry.listVersions('finance', 'trial'));

// 正式发布
registry.publishRule('finance', 'v2.0', { setAsDefault: true, remark: '试运行通过，正式发布' });
registry.updateRule('finance', 'v2.0', {
  description: '金融行业规则 v2.0 - 正式发布版',
  recommended: ['phoneNumber', 'userName', 'merchantName', 'transactionType'],
  changeLog: '正式发布，包含所有 v2.0 新要求',
});
console.log('\n🎉 v2.0 正式发布（设为默认）');
console.log('   已发布版本:', registry.listVersions('finance', 'published'));
console.log('   默认版本:', registry.getDefaultVersion('finance'));

const statusHistory = registry.getStatusHistory('finance', 'v2.0');
console.log('\n📜 v2.0 状态变更历史:');
for (const h of statusHistory) {
  console.log(`   ${h.changedAt}: ${h.fromStatus} → ${h.toStatus} (${h.remark})`);
}
console.log('');

// ============================================================
// 示例 2: 默认只用已发布版本，试运行版本需手动指定
// ============================================================
console.log('=== 示例 2: 规则状态过滤 & 试运行版本指定 ===\n');

const description: DataProductDescription = {
  productId: 'PROD-001',
  productName: '用户交易行为数据集',
  description: '包含用户近一年的交易记录',
  dataSource: '核心交易系统',
  coveragePeriod: { start: '2024-01-01', end: '2024-12-31' },
  updateFrequency: 'daily',
  lastUpdatedAt: '2025-01-10T08:00:00Z',
};

const fields: FieldDefinition[] = [
  { name: 'id', type: 'string', description: '记录ID', nullable: false },
  { name: 'userId', type: 'string', description: '用户ID', nullable: false },
  { name: 'accountId', type: 'string', description: '账户ID', nullable: false },
  { name: 'accountNumber', type: 'string', description: '资金账号', nullable: false },
  { name: 'transactionAmount', type: 'number', description: '交易金额', nullable: false },
  { name: 'transactionTime', type: 'date', description: '交易时间', nullable: false },
  { name: 'currency', type: 'string', description: '币种', nullable: false },
];

const sample: SampleSummary = {
  totalRecords: 5000,
  fieldValues: {
    id: { nonNullCount: 5000, uniqueCount: 5000, nullCount: 0 },
    userId: { nonNullCount: 5000, uniqueCount: 1200, nullCount: 0 },
    accountId: { nonNullCount: 5000, uniqueCount: 1500, nullCount: 0 },
    accountNumber: { nonNullCount: 4950, uniqueCount: 1500, nullCount: 50 },
    transactionAmount: { nonNullCount: 4980, minValue: 0.01, maxValue: 500000, nullCount: 20 },
    transactionTime: { nonNullCount: 5000, nullCount: 0 },
    currency: { nonNullCount: 5000, uniqueCount: 3, nullCount: 0 },
  },
};

const authorization: AuthorizationScope = {
  allowedPurposes: ['数据分析', '风控评估'],
  allowedRecipients: ['风控部门'],
  retentionPeriod: '3年',
  dataProcessingRegions: ['中国大陆'],
};

const sdkDefault = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  usePublishedRulesOnly: true,
});

console.log('--- 默认情况（只用已发布版本）---');
const resultPublished = sdkDefault.score({
  productId: 'PROD-STATUS-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
});
console.log(`规则版本: ${resultPublished.metadata.industryConfigVersion}`);
console.log(`规则状态: ${resultPublished.metadata.industryConfigStatus}`);
console.log(`规则说明: ${resultPublished.metadata.industryConfigDescription}`);
console.log(`字段完整性得分: ${resultPublished.dimensionScores.fieldCompleteness.score}分`);

// 先注册一个试运行版本
if (registry.hasRule('finance', 'v3.0-trial')) registry.removeRule('finance', 'v3.0-trial');
registry.registerRule('finance', 'v3.0-trial', {
  version: 'v3.0-trial',
  description: '金融行业规则 v3.0 - 试运行版（要求更高）',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency', 'riskLevel', 'phoneNumber'],
  recommended: ['userName', 'merchantName'],
}, { initialStatus: 'trial' });

console.log('\n--- 试运行版本（默认情况下不可用，会回退到已发布版本）---');
const resultTrialDefault = sdkDefault.score({
  productId: 'PROD-STATUS-TEST2',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v3.0-trial',
});
console.log(`请求版本: v3.0-trial`);
console.log(`实际使用版本: ${resultTrialDefault.metadata.industryConfigVersion}`);
console.log(`回退原因: ${resultTrialDefault.metadata.ruleFallbackReason || '无'}`);

console.log('\n--- 手动启用试运行规则 ---');
const sdkAllowTrial = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  allowTrialRules: true,
});
const resultTrial = sdkAllowTrial.score({
  productId: 'PROD-STATUS-TEST3',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v3.0-trial',
});
console.log(`请求版本: v3.0-trial`);
console.log(`实际使用版本: ${resultTrial.metadata.industryConfigVersion}`);
console.log(`规则状态: ${resultTrial.metadata.industryConfigStatus}`);
console.log(`字段完整性得分: ${resultTrial.dimensionScores.fieldCompleteness.score}分（要求更高所以分数更低）`);
console.log('');

// ============================================================
// 示例 3: 规则覆盖 - 同版本覆盖后字段完整性显示覆盖信息
// ============================================================
console.log('=== 示例 3: 规则覆盖 & 字段完整性结果显示 ===\n');

const sdkOverride = new DataQualitySDK({ defaultIndustry: 'finance' });

console.log('--- 覆盖前（使用 v2.0 发布版规则）---');
const resultBefore = sdkOverride.score({
  productId: 'PROD-OVERRIDE-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});
console.log(`规则来源: ${resultBefore.dimensionScores.fieldCompleteness.ruleSource}`);
console.log(`是否覆盖: ${resultBefore.dimensionScores.fieldCompleteness.isOverridden ? '是' : '否'}`);
console.log(`必填字段: ${resultBefore.dimensionScores.fieldCompleteness.requiredFields.join(', ')}`);
console.log(`字段完整性得分: ${resultBefore.dimensionScores.fieldCompleteness.score}分`);

const overrideConfig: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '金融行业规则 v2.0 - 业务方自定义覆盖版',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency', 'customField1'],
  recommended: ['customField2', 'customField3'],
  changeLog: '业务方自定义：增加 customField1 为必填，customField2/3 为推荐',
};
sdkOverride.overrideIndustryRule('finance' as IndustryType, 'v2.0', overrideConfig);

console.log('\n--- 覆盖后（同版本 v2.0，配置已被覆盖）---');
const resultAfter = sdkOverride.score({
  productId: 'PROD-OVERRIDE-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});
console.log(`规则来源: ${resultAfter.dimensionScores.fieldCompleteness.ruleSource}`);
console.log(`是否覆盖: ${resultAfter.dimensionScores.fieldCompleteness.isOverridden ? '是' : '否'}`);
console.log(`规则描述: ${resultAfter.dimensionScores.fieldCompleteness.ruleDescription}`);
console.log(`必填字段: ${resultAfter.dimensionScores.fieldCompleteness.requiredFields.join(', ')}`);
console.log(`字段完整性得分: ${resultAfter.dimensionScores.fieldCompleteness.score}分（新增必填字段缺失，分数下降）`);
console.log('');

// ============================================================
// 示例 4: 多方案对比（3套以上规则/权重）
// ============================================================
console.log('=== 示例 4: 多方案评分对比 ===\n');

const resultA = sdkDefault.score({
  productId: 'PROD-MULTI-COMPARE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v1.0',
});

const resultB = sdkDefault.score({
  productId: 'PROD-MULTI-COMPARE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

const resultC = sdkDefault.score({
  productId: 'PROD-MULTI-COMPARE',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  customWeights: {
    fieldCompleteness: 35,
    sampleCompleteness: 15,
    sensitiveField: 20,
    updateFrequency: 10,
    descriptionCompleteness: 10,
    authorization: 10,
  },
  industryConfigVersion: 'v2.0',
});

const multiComparison = sdkDefault.compareMultiScoringResults(
  [resultA, resultB, resultC],
  {
    labels: ['规则v1.0', '规则v2.0', 'v2.0+高字段权重'],
    bestScoreCriteria: 'highestScore',
  }
);

console.log(`🏆 最佳方案: ${multiComparison.bestScenario.label}`);
console.log(`   得分: ${multiComparison.bestScenario.totalScorePercent}%`);
console.log(`   理由: ${multiComparison.bestScenario.reason}`);
console.log('');

console.log('📊 方案排名:');
for (let i = 0; i < multiComparison.scenarios.length; i++) {
  const s = multiComparison.scenarios[i];
  console.log(`  ${i + 1}. ${s.label} — ${s.totalScorePercent}%, ${s.grade}级`);
}
console.log('');

console.log('📈 维度对比（各维度最佳方案）:');
for (const dim of multiComparison.dimensionComparison) {
  console.log(`  ${dim.dimensionName}: 最佳=${dim.bestLabel} (${dim.scores[dim.bestLabel]}%), 最大差值=${dim.maxDiff}%`);
}
console.log('');

console.log('--- 多方案对比报告（Markdown）---');
const multiReport = sdkDefault.generateMultiComparisonReport(
  [resultA, resultB, resultC],
  {
    labels: ['规则v1.0', '规则v2.0', 'v2.0+高字段权重'],
    format: 'markdown',
  }
);
console.log(multiReport);
console.log('');

// ============================================================
// 示例 5: 规则变更影响预估
// ============================================================
console.log('=== 示例 5: 规则变更影响预估 ===\n');

const impactItems = [
  { productId: 'HIST-001', missingFields: 0 },
  { productId: 'HIST-002', missingFields: 2 },
  { productId: 'HIST-003', missingFields: 1 },
  { productId: 'HIST-004', missingFields: 3 },
  { productId: 'HIST-005', missingFields: 0 },
];

const impactInputs = impactItems.map((item) => {
  const adjustedFields = fields.slice(0, fields.length - item.missingFields);
  return {
    productId: item.productId,
    description,
    fields: adjustedFields,
    sample,
    authorization,
    industry: 'finance' as IndustryType,
  };
});

// 先用 v1.0 跑一下，展示基准结果
const baselineForDisplay = impactInputs.map((input) =>
  sdkDefault.score({ ...input, industryConfigVersion: 'v1.0' })
);

console.log(`基准版本 (v1.0): ${baselineForDisplay.length} 个产品`);
console.log(`  平均得分: ${(baselineForDisplay.reduce((s, r) => s + r.totalScore / r.maxScore * 100, 0) / baselineForDisplay.length).toFixed(2)}%`);
console.log(`  等级分布: S=${baselineForDisplay.filter(r => r.grade === 'S').length}, A=${baselineForDisplay.filter(r => r.grade === 'A').length}, B=${baselineForDisplay.filter(r => r.grade === 'B').length}`);
console.log('');

console.log('🔮 分析升级到 v2.0 的影响...');
const impactAnalysis = sdkDefault.analyzeRuleImpact(impactInputs, 'v2.0', {
  industry: 'finance',
  baselineVersion: 'v1.0',
});

console.log(`\n📊 影响分析结果:`);
console.log(`  等级提升: ${impactAnalysis.gradeChanges.improved} 个`);
console.log(`  等级下降: ${impactAnalysis.gradeChanges.declined} 个`);
console.log(`  等级不变: ${impactAnalysis.gradeChanges.unchanged} 个`);
console.log(`  平均分变化: ${impactAnalysis.scoreChanges.averageScoreChange > 0 ? '+' : ''}${impactAnalysis.scoreChanges.averageScoreChange}%`);
console.log('');

if (impactAnalysis.newRisks.length > 0) {
  console.log(`🆕 新增风险 (${impactAnalysis.newRisks.length} 项):`);
  for (const r of impactAnalysis.newRisks.slice(0, 3)) {
    console.log(`  [${r.level}] ${r.message} — 影响 ${r.occurrenceCount}/${impactAnalysis.totalProducts} 个产品 (${r.occurrencePercentage}%)`);
  }
  console.log('');
}

if (impactAnalysis.recommendations.length > 0) {
  console.log('💡 发布建议:');
  for (let i = 0; i < impactAnalysis.recommendations.length; i++) {
    console.log(`  ${i + 1}. ${impactAnalysis.recommendations[i]}`);
  }
}
console.log('');

console.log('--- 影响分析报告（Markdown）---');
const impactReport = sdkDefault.generateImpactAnalysisReport(impactAnalysis, 'markdown');
console.log(impactReport);
console.log('');

// ============================================================
// 示例 6: 审核交付材料包
// ============================================================
console.log('=== 示例 6: 审核交付材料包 ===\n');

const batchItems = [
  { productId: 'APP-001', productName: '消费交易数据集', quality: 'good' },
  { productId: 'APP-002', productName: '理财用户画像', quality: 'medium' },
  { productId: 'APP-003', productName: '风控行为数据', quality: 'poor' },
  { productId: 'APP-004', productName: '支付流水明细', quality: 'good' },
  { productId: 'APP-005', productName: '客户标签体系', quality: 'medium' },
];

const batchResults = batchItems.map((item) => {
  let adjustedFields = fields;
  let adjustedSample = sample;

  if (item.quality === 'poor') {
    adjustedFields = fields.slice(0, 5);
  } else if (item.quality === 'medium') {
    adjustedFields = fields.slice(0, 8);
  }

  return sdkDefault.score({
    productId: item.productId,
    description: { ...description, productId: item.productId, productName: item.productName },
    fields: adjustedFields,
    sample: adjustedSample,
    authorization,
    industry: 'finance' as IndustryType,
    industryConfigVersion: 'v2.0',
  });
});

const batchResult = sdkDefault.scoreBatch({ items: [] });
(batchResult as any).results = batchResults;
(batchResult as any).summary = {
  totalItems: batchResults.length,
  gradeDistribution: batchResults.reduce((acc, r) => {
    acc[r.grade]++;
    return acc;
  }, { S: 0, A: 0, B: 0, C: 0, D: 0 } as any),
  averageScore: batchResults.reduce((s, r) => s + r.totalScore / r.maxScore, 0) / batchResults.length,
  highFrequencyRisks: [],
  lowScoringDimensions: [],
};

// 使用更完整的批量评分（真实批量）
const realBatchInput = {
  items: batchItems.map((item) => ({
    productId: item.productId,
    description: { ...description, productId: item.productId, productName: item.productName },
    fields: item.quality === 'poor' ? fields.slice(0, 5) :
            item.quality === 'medium' ? fields.slice(0, 8) : fields,
    sample: sample,
    authorization,
    industry: 'finance' as IndustryType,
    industryConfigVersion: 'v2.0',
  })),
};
const realBatchResult = sdkDefault.scoreBatch(realBatchInput);

console.log('--- 生成上架审核材料包 ---');
const auditPkg = sdkDefault.generateAuditDeliveryPackage(realBatchResult, {
  applicationId: 'APP-REVIEW-2025-001',
  passThreshold: 70,
});

console.log(`材料包编号: ${auditPkg.packageId}`);
console.log(`上架申请号: ${auditPkg.applicationId}`);
console.log(`总产品数: ${auditPkg.summary.totalProducts} 个`);
console.log(`通过: ${auditPkg.summary.passCount} 个 | 不通过: ${auditPkg.summary.failCount} 个 | 需关注: ${auditPkg.summary.warningCount} 个`);
console.log(`整体通过率: ${auditPkg.summary.overallPassRate}%`);
console.log('');

console.log('📋 整改清单:');
for (let i = 0; i < auditPkg.rectificationList.length; i++) {
  const rect = auditPkg.rectificationList[i];
  console.log(`  ${i + 1}. ${rect.productId} [${rect.priority.toUpperCase()}] - ${rect.issues.length} 个问题`);
}
console.log('');

console.log('📐 规则信息:');
console.log(`  行业: ${auditPkg.ruleInfo.industry}`);
console.log(`  版本: ${auditPkg.ruleInfo.version}`);
console.log(`  状态: ${auditPkg.ruleInfo.status}`);
console.log(`  来源: ${auditPkg.ruleInfo.source}`);
console.log('');

console.log('--- 审核材料包（Markdown 格式，可直接贴审核单）---');
const auditPkgMarkdown = sdkDefault.generateAuditDeliveryPackageText(realBatchResult, {
  applicationId: 'APP-REVIEW-2025-001',
  format: 'markdown',
  passThreshold: 70,
});
console.log(auditPkgMarkdown);
console.log('');

console.log('========================================');
console.log('        所有示例执行完成！');
console.log('========================================');
