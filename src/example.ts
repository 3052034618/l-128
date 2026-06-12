import DataQualitySDK, {
  DataProductDescription,
  FieldDefinition,
  SampleSummary,
  AuthorizationScope,
  IndustryType,
  IndustryRequiredFieldsConfig,
  IndustryRuleRegistry,
  ScoringResult,
  ScoringInput,
} from './index';

const registry = IndustryRuleRegistry.getInstance();
registry.reset();

console.log('========================================');
console.log('  数据要素质量评分 SDK v5.0 综合示例');
console.log('  规则发布前运营闭环');
console.log('========================================\n');

// ============================================================
// 先建立完整的规则体系（草稿、试运行、已发布、已停用）
// ============================================================
console.log('=== 初始化规则体系 ===\n');

// 先清理 finance 行业的内置规则，避免重复注册
const existingFinanceVersions = registry.listVersions('finance' as IndustryType);
for (const v of existingFinanceVersions) {
  registry.removeRule('finance' as IndustryType, v);
}

const financeV1: IndustryRequiredFieldsConfig = {
  version: 'v1.0',
  description: '金融行业规则 v1.0 - 基础版',
  required: ['transactionId', 'userId', 'accountId', 'transactionAmount', 'transactionTime', 'currency'],
  recommended: ['merchantName', 'transactionType'],
};

const financeV2: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '金融行业规则 v2.0 - 正式发布版',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency'],
  recommended: ['phoneNumber', 'userName', 'merchantName', 'transactionType'],
  changeLog: '新增 accountNumber 为必填字段，提升数据完整性要求',
};

const financeV3Trial: IndustryRequiredFieldsConfig = {
  version: 'v3.0-trial',
  description: '金融行业规则 v3.0 - 试运行版（更严格）',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency', 'riskLevel'],
  recommended: ['phoneNumber', 'userName', 'merchantName', 'transactionType', 'ipAddress'],
  changeLog: '新增 riskLevel 为必填，提升风控要求',
};

const financeV3Draft: IndustryRequiredFieldsConfig = {
  version: 'v3.1-draft',
  description: '金融行业规则 v3.1 - 草稿版（规划中）',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency', 'riskLevel', 'deviceId'],
  recommended: ['phoneNumber', 'userName', 'merchantName', 'transactionType', 'ipAddress', 'location'],
  changeLog: '计划新增 deviceId 为必填，提升反欺诈能力',
};

const financeV0Deprecated: IndustryRequiredFieldsConfig = {
  version: 'v0.9',
  description: '金融行业规则 v0.9 - 已停用',
  required: ['transactionId', 'userId', 'transactionAmount'],
  recommended: ['accountId'],
};

// 注册各版本
registry.registerRule('finance', 'v0.9', financeV0Deprecated, { initialStatus: 'deprecated' });
registry.registerRule('finance', 'v1.0', financeV1, { initialStatus: 'published', setAsDefault: false });
registry.registerRule('finance', 'v2.0', financeV2, { initialStatus: 'published', setAsDefault: true });
registry.registerRule('finance', 'v3.0-trial', financeV3Trial, { initialStatus: 'trial' });
registry.registerRule('finance', 'v3.1-draft', financeV3Draft, { initialStatus: 'draft' });

// 添加一些状态变更历史
registry.startTrial('finance', 'v3.0-trial', { remark: '进入试运行阶段，收集反馈', trialEndAt: '2026-07-31' });
console.log('✅ 规则体系初始化完成');
console.log(`   已停用: v0.9 | 已发布: v1.0, v2.0(默认) | 试运行: v3.0-trial | 草稿: v3.1-draft`);
console.log('');

// ============================================================
// 准备测试数据
// ============================================================
const description: DataProductDescription = {
  productId: 'PROD-001',
  productName: '用户交易行为数据集',
  description: '包含用户近一年的交易记录',
  dataSource: '核心交易系统',
  coveragePeriod: { start: '2024-01-01', end: '2024-12-31' },
  updateFrequency: 'daily',
  lastUpdatedAt: '2026-06-10T08:00:00Z',
};

const fields: FieldDefinition[] = [
  { name: 'transactionId', type: 'string', description: '交易ID', nullable: false },
  { name: 'userId', type: 'string', description: '用户ID', nullable: false },
  { name: 'accountId', type: 'string', description: '账户ID', nullable: false },
  { name: 'accountNumber', type: 'string', description: '资金账号', nullable: false },
  { name: 'transactionAmount', type: 'number', description: '交易金额', nullable: false },
  { name: 'transactionTime', type: 'date', description: '交易时间', nullable: false },
  { name: 'currency', type: 'string', description: '币种', nullable: false },
  { name: 'riskLevel', type: 'string', description: '风险等级', nullable: true },
];

const sample: SampleSummary = {
  totalRecords: 5000,
  fieldValues: {
    transactionId: { nonNullCount: 5000, uniqueCount: 5000, nullCount: 0 },
    userId: { nonNullCount: 5000, uniqueCount: 1200, nullCount: 0 },
    accountId: { nonNullCount: 5000, uniqueCount: 1500, nullCount: 0 },
    accountNumber: { nonNullCount: 4950, uniqueCount: 1500, nullCount: 50 },
    transactionAmount: { nonNullCount: 4980, minValue: 0.01, maxValue: 500000, nullCount: 20 },
    transactionTime: { nonNullCount: 5000, nullCount: 0 },
    currency: { nonNullCount: 5000, uniqueCount: 3, nullCount: 0 },
    riskLevel: { nonNullCount: 3000, uniqueCount: 5, nullCount: 2000 },
  },
};

const authorization: AuthorizationScope = {
  allowedPurposes: ['数据分析', '风控评估'],
  allowedRecipients: ['风控部门'],
  retentionPeriod: '3年',
  dataProcessingRegions: ['中国大陆'],
};

// ============================================================
// 示例 1: 规则发布前评审视图
// ============================================================
console.log('=== 示例 1: 规则发布前评审视图 ===\n');

const sdkDefault = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  usePublishedRulesOnly: true,
});

// 准备影响分析输入数据
const impactInputs: ScoringInput[] = [
  { productId: 'PROD-IMPACT-001', description, fields, sample, authorization, industry: 'finance' as IndustryType },
  { productId: 'PROD-IMPACT-002', description: { ...description, productId: 'PROD-IMPACT-002' }, fields: fields.slice(0, 7), sample, authorization, industry: 'finance' as IndustryType },
  { productId: 'PROD-IMPACT-003', description: { ...description, productId: 'PROD-IMPACT-003' }, fields: fields.slice(0, 6), sample, authorization, industry: 'finance' as IndustryType },
  { productId: 'PROD-IMPACT-004', description: { ...description, productId: 'PROD-IMPACT-004' }, fields, sample, authorization, industry: 'finance' as IndustryType },
  { productId: 'PROD-IMPACT-005', description: { ...description, productId: 'PROD-IMPACT-005' }, fields: fields.slice(0, 8), sample, authorization, industry: 'finance' as IndustryType },
];

console.log('--- 生成规则评审视图（带影响分析）---');
const sdkForReview = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  allowTrialRules: true,
});
const reviewView = sdkForReview.generateRuleReviewView({
  industries: ['finance' as IndustryType],
  includeImpactAnalysis: true,
  impactAnalysisInputs: impactInputs,
  baselineVersion: 'v2.0',
});

console.log(`📊 规则汇总:`);
console.log(`   总规则数: ${reviewView.summary.totalRules}`);
console.log(`   草稿: ${reviewView.summary.draftCount} | 试运行: ${reviewView.summary.trialCount} | 已发布: ${reviewView.summary.publishedCount} | 已停用: ${reviewView.summary.deprecatedCount}`);
console.log(`   待评审: ${reviewView.summary.pendingReviewCount}`);
console.log(`   建议发布: ${reviewView.summary.recommendApproveCount} | 谨慎发布: ${reviewView.summary.recommendCautionCount} | 阻止发布: ${reviewView.summary.recommendBlockCount}`);
console.log('');

console.log('📋 各版本详情:');
const financeRules = reviewView.rulesByIndustry['finance'];
for (const rule of financeRules) {
  const statusIcon = rule.status === 'published' ? '✅' : rule.status === 'trial' ? '🧪' : rule.status === 'draft' ? '✏️' : '⏹️';
  const recIcon = rule.publishRecommendation === 'approve' ? '✅' : rule.publishRecommendation === 'caution' ? '⚠️' : rule.publishRecommendation === 'block' ? '❌' : '⏳';
  console.log(`   ${statusIcon} ${rule.version} [${rule.status}]`);
  console.log(`      说明: ${rule.description}`);
  console.log(`      发布建议: ${recIcon} ${rule.publishRecommendation} - ${rule.recommendationReason}`);
  if (rule.impactSummary) {
    console.log(`      影响分析: ${rule.impactSummary.analyzedProducts} 个产品, 等级下降 ${rule.impactSummary.gradeDeclines} 个, 新增风险 ${rule.impactSummary.newRisks} 个`);
    console.log(`      平均分变化: ${rule.impactSummary.averageScoreChange > 0 ? '+' : ''}${rule.impactSummary.averageScoreChange}%`);
  }
  if (rule.lastChange) {
    const fromLabel = rule.lastChange.fromStatus === null ? '创建' : rule.lastChange.fromStatus;
    console.log(`      最近变更: ${fromLabel} → ${rule.lastChange.toStatus} (${rule.lastChange.changedAt})`);
    if (rule.lastChange.remark) console.log(`      备注: ${rule.lastChange.remark}`);
  }
  console.log('');
}

console.log('--- 规则评审视图报告（Markdown 片段）---');
const reviewReport = sdkForReview.generateRuleReviewViewReport({
  industries: ['finance' as IndustryType],
  includeImpactAnalysis: true,
  impactAnalysisInputs: impactInputs,
  baselineVersion: 'v2.0',
  format: 'markdown',
});
console.log(reviewReport.split('\n').slice(0, 50).join('\n'));
console.log('...\n');

// ============================================================
// 示例 2: 影响预估细化 - 产品变化明细、风险清单、多维度分组
// ============================================================
console.log('=== 示例 2: 影响预估细化分析 ===\n');

console.log('🔮 分析升级 v2.0 → v3.0-trial 的详细影响...');
const impactAnalysis = sdkForReview.analyzeRuleImpact(impactInputs, 'v3.0-trial', {
  industry: 'finance',
  baselineVersion: 'v2.0',
});

console.log(`\n📊 总体影响:`);
console.log(`   等级提升: ${impactAnalysis.gradeChanges.improved} | 下降: ${impactAnalysis.gradeChanges.declined} | 不变: ${impactAnalysis.gradeChanges.unchanged}`);
console.log(`   平均分变化: ${impactAnalysis.scoreChanges.averageScoreChange > 0 ? '+' : ''}${impactAnalysis.scoreChanges.averageScoreChange}%`);
console.log('');

// 产品变化明细
if (impactAnalysis.productDetails && impactAnalysis.productDetails.length > 0) {
  console.log('📋 产品变化明细:');
  for (const p of impactAnalysis.productDetails) {
    const changeEmoji = p.gradeChange === 'improved' ? '⬆️' : p.gradeChange === 'declined' ? '⬇️' : '➡️';
    console.log(`   ${p.productId} ${changeEmoji} ${p.baselineGrade}→${p.targetGrade} (${p.scoreChange > 0 ? '+' : ''}${p.scoreChange}%)`);
    if (p.newRisks.length > 0) {
      console.log(`     新增风险: ${p.newRisks.slice(0, 2).map(r => `[${r.level}]${r.message}`).join('; ')}`);
    }
  }
  console.log('');
}

// 发布风险清单
if (impactAnalysis.releaseRiskList && impactAnalysis.releaseRiskList.length > 0) {
  console.log(`⚠️  发布风险清单 (共 ${impactAnalysis.releaseRiskList.length} 项):`);
  const criticalRisks = impactAnalysis.releaseRiskList.filter(r => r.severity === 'critical');
  const highRisks = impactAnalysis.releaseRiskList.filter(r => r.severity === 'high');
  console.log(`   严重: ${criticalRisks.length} | 高: ${highRisks.length} | 中: ${impactAnalysis.releaseRiskList.length - criticalRisks.length - highRisks.length}`);
  console.log('');
  console.log('   高优先级风险前5项:');
  for (let i = 0; i < Math.min(5, impactAnalysis.releaseRiskList.length); i++) {
    const r = impactAnalysis.releaseRiskList[i];
    console.log(`   ${i + 1}. [${r.severity.toUpperCase()}] ${r.productId} - ${r.description}`);
    console.log(`      建议: ${r.recommendation}`);
  }
  console.log('');
}

// 多维度分组
if (impactAnalysis.groupedSummary) {
  console.log('📁 按下降等级分组:');
  for (const [key, data] of Object.entries(impactAnalysis.groupedSummary.byGradeDecline)) {
    console.log(`   ${key}: ${data.count} 个产品, 平均下降 ${data.averageScoreDrop}%`);
  }
  console.log('');

  console.log('🏷️  按风险类别分组:');
  for (const [cat, data] of Object.entries(impactAnalysis.groupedSummary.byRiskCategory)) {
    console.log(`   ${cat}: 影响 ${data.totalProducts} 个产品, 高优先级 ${data.highPriorityCount} 次`);
  }
  console.log('');
}

console.log('--- 影响分析报告（Markdown 片段，含风险清单和分组）---');
const impactReport = sdkForReview.generateImpactAnalysisReport(impactAnalysis, 'markdown');
console.log(impactReport.split('\n').slice(0, 60).join('\n'));
console.log('...\n');

// ============================================================
// 示例 3: 批量评分支持试运行版本
// ============================================================
console.log('=== 示例 3: 批量评分支持试运行版本 ===\n');

const sdkAllowTrial = new DataQualitySDK({
  defaultIndustry: 'finance',
  autoNormalizeWeights: true,
  allowTrialRules: true,
});

const batchItems = [
  { productId: 'BATCH-001', productName: '消费交易数据集' },
  { productId: 'BATCH-002', productName: '理财用户画像' },
  { productId: 'BATCH-003', productName: '风控行为数据' },
  { productId: 'BATCH-004', productName: '支付流水明细' },
  { productId: 'BATCH-005', productName: '客户标签体系' },
];

const batchInput = {
  items: batchItems.map((item) => ({
    productId: item.productId,
    description: { ...description, productId: item.productId, productName: item.productName },
    fields,
    sample,
    authorization,
    industry: 'finance' as IndustryType,
    industryConfigVersion: 'v3.0-trial',
  })),
};

console.log('--- 使用试运行规则 v3.0-trial 批量评分 ---');
console.log(`SDK 配置: allowTrialRules = true`);
const batchResult = sdkAllowTrial.scoreBatch(batchInput);

console.log(`\n📊 批量评分结果:`);
console.log(`   总产品数: ${batchResult.results.length}`);
console.log(`   平均得分: ${(batchResult.summary.averageScore * 100).toFixed(2)}%`);
console.log(`   等级分布: S=${batchResult.summary.gradeDistribution.S}, A=${batchResult.summary.gradeDistribution.A}, B=${batchResult.summary.gradeDistribution.B}, C=${batchResult.summary.gradeDistribution.C}, D=${batchResult.summary.gradeDistribution.D}`);
console.log('');

// 检查批量结果中的规则信息
const firstResult = batchResult.results[0];
console.log(`🔍 批量结果中的规则信息（来自第一个产品）:`);
console.log(`   规则版本: ${firstResult.metadata.industryConfigVersion}`);
console.log(`   规则状态: ${firstResult.metadata.industryConfigStatus}`);
console.log(`   规则说明: ${firstResult.metadata.industryConfigDescription}`);
console.log(`   是否试运行: ${firstResult.metadata.industryConfigStatus === 'trial' ? '是' : '否'}`);
if (firstResult.metadata.industryConfigTrialStartAt) {
  console.log(`   试运行开始: ${firstResult.metadata.industryConfigTrialStartAt}`);
}
if (firstResult.metadata.industryConfigTrialEndAt) {
  console.log(`   试运行结束: ${firstResult.metadata.industryConfigTrialEndAt}`);
}
console.log('');

console.log('--- 使用试运行规则生成审核材料包 ---');
const auditPkg = sdkAllowTrial.generateAuditDeliveryPackage(batchResult, {
  applicationId: 'APP-REVIEW-TRIAL-001',
  passThreshold: 70,
});
console.log(`材料包规则信息:`);
console.log(`   版本: ${auditPkg.ruleInfo.version}`);
console.log(`   状态: ${auditPkg.ruleInfo.status}`);
console.log(`   是否试运行: ${auditPkg.ruleInfo.status === 'trial' ? '是' : '否'}`);
if (auditPkg.ruleInfo.trialStartAt) console.log(`   试运行时间: ${auditPkg.ruleInfo.trialStartAt}${auditPkg.ruleInfo.trialEndAt ? ' ~ ' + auditPkg.ruleInfo.trialEndAt : ''}`);
console.log('');

// ============================================================
// 示例 4: 草稿规则不参与正式评分 & 回退报告增强
// ============================================================
console.log('=== 示例 4: 草稿规则不参与正式评分 & 回退报告 ===\n');

console.log('--- 尝试使用草稿版本 v3.1-draft（正式 SDK 会回退）---');
const resultDraftDefault = sdkDefault.score({
  productId: 'PROD-DRAFT-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v3.1-draft',
});
console.log(`请求版本: v3.1-draft (草稿)`);
console.log(`实际使用: ${resultDraftDefault.metadata.industryConfigVersion}`);
console.log(`规则状态: ${resultDraftDefault.metadata.industryConfigStatus}`);
if (resultDraftDefault.metadata.ruleFallbackReason) {
  console.log(`⚠️  回退原因: ${resultDraftDefault.metadata.ruleFallbackReason}`);
}
if (resultDraftDefault.metadata.ruleFallbackInfo) {
  const fb = resultDraftDefault.metadata.ruleFallbackInfo;
  console.log(`📝 回退详情: 请求 ${fb.requestedIndustry}/${fb.requestedVersion} → 实际 ${fb.fallbackIndustry}/${fb.fallbackVersion}`);
}
console.log('');

console.log('--- 尝试使用已停用版本 v0.9（正式 SDK 会回退）---');
const resultDeprecated = sdkDefault.score({
  productId: 'PROD-DEPRECATED-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v0.9',
});
console.log(`请求版本: v0.9 (已停用)`);
console.log(`实际使用: ${resultDeprecated.metadata.industryConfigVersion}`);
if (resultDeprecated.metadata.ruleFallbackReason) {
  console.log(`⚠️  回退原因: ${resultDeprecated.metadata.ruleFallbackReason}`);
}
console.log('');

// ============================================================
// 示例 5: 评分报告规则信息补全展示
// ============================================================
console.log('=== 示例 5: 报告规则信息补全展示 ===\n');

console.log('--- 使用发布版本 v2.0 评分，查看完整规则信息 ---');
const resultV2 = sdkDefault.score({
  productId: 'PROD-REPORT-TEST',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

console.log(`📋 完整规则信息:`);
console.log(`   行业: ${resultV2.metadata.industry}`);
console.log(`   版本: ${resultV2.metadata.industryConfigVersion}`);
console.log(`   说明: ${resultV2.metadata.industryConfigDescription}`);
console.log(`   状态: ${resultV2.metadata.industryConfigStatus}`);
console.log(`   来源: ${resultV2.metadata.industryConfigSource}`);
console.log(`   是否默认版本: ${resultV2.metadata.industryConfigIsDefault ? '是' : '否'}`);
console.log(`   是否被覆盖: ${resultV2.metadata.industryConfigIsOverridden ? '是' : '否'}`);
if (resultV2.metadata.industryConfigRegisteredAt) console.log(`   注册时间: ${resultV2.metadata.industryConfigRegisteredAt}`);
if (resultV2.metadata.industryConfigPublishedAt) console.log(`   发布时间: ${resultV2.metadata.industryConfigPublishedAt}`);
if (resultV2.metadata.industryConfigEffectiveAt) console.log(`   生效时间: ${resultV2.metadata.industryConfigEffectiveAt}`);
if (resultV2.metadata.industryConfigChangeLog) console.log(`   变更日志: ${resultV2.metadata.industryConfigChangeLog}`);
console.log('');

console.log('--- 审核材料包中的完整规则信息（Markdown）---');
const auditPkgMarkdown = sdkDefault.generateAuditDeliveryPackageText(batchResult, {
  applicationId: 'APP-REVIEW-2026-001',
  format: 'markdown',
  passThreshold: 70,
});
const mdLines = auditPkgMarkdown.split('\n');
const ruleInfoSection = mdLines.slice(mdLines.findIndex(l => l.includes('## 六、规则信息')));
console.log(ruleInfoSection.slice(0, 30).join('\n'));
console.log('');

console.log('--- 字段完整性结果中的规则覆盖信息 ---');
const overrideConfig: IndustryRequiredFieldsConfig = {
  version: 'v2.0',
  description: '金融行业规则 v2.0 - 业务方自定义覆盖版',
  required: ['transactionId', 'userId', 'accountId', 'accountNumber', 'transactionAmount', 'transactionTime', 'currency', 'customField1'],
  recommended: ['customField2', 'customField3'],
  changeLog: '业务方自定义覆盖：增加 customField1 为必填',
};
sdkDefault.overrideIndustryRule('finance' as IndustryType, 'v2.0', overrideConfig);

const resultOverride = sdkDefault.score({
  productId: 'PROD-OVERRIDE-REPORT',
  description,
  fields,
  sample,
  authorization,
  industry: 'finance' as IndustryType,
  industryConfigVersion: 'v2.0',
});

const fieldResult = resultOverride.dimensionScores.fieldCompleteness;
console.log(`   规则来源: ${fieldResult.ruleSource}`);
console.log(`   是否覆盖: ${fieldResult.isOverridden ? '是' : '否'}`);
console.log(`   规则描述: ${fieldResult.ruleDescription}`);
console.log(`   规则状态: ${fieldResult.ruleStatus}`);
if (fieldResult.ruleEffectiveAt) console.log(`   生效时间: ${fieldResult.ruleEffectiveAt}`);
console.log(`   必填字段: ${fieldResult.requiredFields.join(', ')}`);
console.log('');

console.log('========================================');
console.log('        所有示例执行完成！');
console.log('========================================');
