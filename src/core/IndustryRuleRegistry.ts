import {
  IndustryType,
  IndustryRequiredFieldsConfig,
  RegisteredIndustryConfig,
  RuleQueryResult,
  RuleFallbackInfo,
  RuleStatus,
  RuleStatusTransition,
} from '../types';
import { INDUSTRY_REQUIRED_FIELDS } from '../config';

export class IndustryRuleRegistry {
  private rules: Map<string, Map<string, RegisteredIndustryConfig>> = new Map();
  private defaultVersions: Map<string, string> = new Map();
  private statusHistory: Map<string, Map<string, RuleStatusTransition[]>> = new Map();
  private static instance: IndustryRuleRegistry | null = null;

  private constructor() {
    this.initializeBuiltInRules();
  }

  public static getInstance(): IndustryRuleRegistry {
    if (!IndustryRuleRegistry.instance) {
      IndustryRuleRegistry.instance = new IndustryRuleRegistry();
    }
    return IndustryRuleRegistry.instance;
  }

  private initializeBuiltInRules(): void {
    for (const [industry, config] of Object.entries(INDUSTRY_REQUIRED_FIELDS)) {
      const registeredConfig: RegisteredIndustryConfig = {
        ...config,
        version: config.version || 'v1.0',
        industry,
        registeredAt: new Date().toISOString(),
        isDefault: true,
        source: 'built-in',
        status: 'published',
        publishedAt: new Date().toISOString(),
      };
      this.storeRule(industry, registeredConfig);
      this.defaultVersions.set(industry, registeredConfig.version);
      this.recordStatusTransition(industry, registeredConfig.version, {
        fromStatus: 'draft',
        toStatus: 'published',
        changedAt: new Date().toISOString(),
        remark: '内置规则初始化发布',
      });
    }
  }

  private storeRule(industry: string, config: RegisteredIndustryConfig): void {
    if (!this.rules.has(industry)) {
      this.rules.set(industry, new Map());
    }
    this.rules.get(industry)!.set(config.version, config);
  }

  private recordStatusTransition(
    industry: string,
    version: string,
    transition: RuleStatusTransition
  ): void {
    if (!this.statusHistory.has(industry)) {
      this.statusHistory.set(industry, new Map());
    }
    const industryHistory = this.statusHistory.get(industry)!;
    if (!industryHistory.has(version)) {
      industryHistory.set(version, []);
    }
    industryHistory.get(version)!.push(transition);
  }

  public registerRule(
    industry: IndustryType,
    version: string,
    config: IndustryRequiredFieldsConfig,
    options?: {
      setAsDefault?: boolean;
      source?: 'custom' | 'override';
      initialStatus?: RuleStatus;
    }
  ): RegisteredIndustryConfig {
    const existing = this.rules.get(industry)?.get(version);
    if (existing) {
      throw new Error(`规则已存在：行业=${industry}, 版本=${version}, 请使用 updateRule() 更新`);
    }

    const status = options?.initialStatus || 'draft';
    const now = new Date().toISOString();

    const registeredConfig: RegisteredIndustryConfig = {
      ...config,
      version,
      industry,
      registeredAt: now,
      isDefault: options?.setAsDefault === true,
      source: options?.source || 'custom',
      status,
    };

    if (status === 'published' && !registeredConfig.publishedAt) {
      registeredConfig.publishedAt = now;
    }
    if (status === 'trial' && !registeredConfig.trialStartAt) {
      registeredConfig.trialStartAt = now;
    }

    this.storeRule(industry, registeredConfig);
    this.recordStatusTransition(industry, version, {
      fromStatus: 'draft',
      toStatus: status,
      changedAt: now,
      remark: '规则注册',
    });

    if (options?.setAsDefault || !this.defaultVersions.has(industry)) {
      this.defaultVersions.set(industry, version);
    }

    return registeredConfig;
  }

  public updateRule(
    industry: IndustryType,
    version: string,
    config: Partial<IndustryRequiredFieldsConfig>
  ): RegisteredIndustryConfig {
    const existing = this.rules.get(industry)?.get(version);
    if (!existing) {
      throw new Error(`规则不存在：行业=${industry}, 版本=${version}`);
    }

    const updated: RegisteredIndustryConfig = {
      ...existing,
      ...config,
      version,
      industry,
    };

    this.storeRule(industry, updated);
    return updated;
  }

  public overrideRule(
    industry: IndustryType,
    version: string,
    config: IndustryRequiredFieldsConfig
  ): RegisteredIndustryConfig {
    const existing = this.rules.get(industry)?.get(version);

    if (existing) {
      const updated: RegisteredIndustryConfig = {
        ...existing,
        ...config,
        version,
        industry,
        source: 'override',
      };
      this.storeRule(industry, updated);
      this.recordStatusTransition(industry, version, {
        fromStatus: existing.status,
        toStatus: existing.status,
        changedAt: new Date().toISOString(),
        remark: '规则配置覆盖更新',
      });
      return updated;
    } else {
      return this.registerRule(industry, version, config, {
        source: 'override',
        initialStatus: 'published',
      });
    }
  }

  public changeRuleStatus(
    industry: IndustryType,
    version: string,
    newStatus: RuleStatus,
    options?: { changedBy?: string; remark?: string }
  ): RegisteredIndustryConfig {
    const existing = this.rules.get(industry)?.get(version);
    if (!existing) {
      throw new Error(`规则不存在：行业=${industry}, 版本=${version}`);
    }

    const oldStatus = existing.status;
    if (oldStatus === newStatus) {
      return existing;
    }

    const now = new Date().toISOString();
    const updated: RegisteredIndustryConfig = { ...existing, status: newStatus };

    if (newStatus === 'published' && !updated.publishedAt) {
      updated.publishedAt = now;
    }
    if (newStatus === 'trial' && !updated.trialStartAt) {
      updated.trialStartAt = now;
    }
    if (newStatus === 'deprecated' && !updated.deprecatedAt) {
      updated.deprecatedAt = now;
    }

    this.storeRule(industry, updated);
    this.recordStatusTransition(industry, version, {
      fromStatus: oldStatus,
      toStatus: newStatus,
      changedAt: now,
      changedBy: options?.changedBy,
      remark: options?.remark || `状态变更: ${oldStatus} → ${newStatus}`,
    });

    return updated;
  }

  public publishRule(
    industry: IndustryType,
    version: string,
    options?: { changedBy?: string; remark?: string; setAsDefault?: boolean }
  ): RegisteredIndustryConfig {
    const result = this.changeRuleStatus(industry, version, 'published', options);
    if (options?.setAsDefault) {
      this.setDefaultVersion(industry, version);
    }
    return result;
  }

  public startTrial(
    industry: IndustryType,
    version: string,
    options?: { changedBy?: string; remark?: string; trialEndAt?: string }
  ): RegisteredIndustryConfig {
    const result = this.changeRuleStatus(industry, version, 'trial', options);
    if (options?.trialEndAt) {
      const updated = { ...result, trialEndAt: options.trialEndAt };
      this.storeRule(industry, updated);
      return updated;
    }
    return result;
  }

  public deprecateRule(
    industry: IndustryType,
    version: string,
    options?: { changedBy?: string; remark?: string }
  ): RegisteredIndustryConfig {
    return this.changeRuleStatus(industry, version, 'deprecated', options);
  }

  public setDefaultVersion(industry: IndustryType, version: string): void {
    const exists = this.rules.get(industry)?.has(version);
    if (!exists) {
      throw new Error(`规则不存在：行业=${industry}, 版本=${version}`);
    }

    const industryRules = this.rules.get(industry)!;
    for (const [v, config] of industryRules.entries()) {
      industryRules.set(v, { ...config, isDefault: v === version });
    }

    this.defaultVersions.set(industry, version);
  }

  public getRule(
    industry: IndustryType,
    version?: string,
    options?: {
      defaultIndustry?: IndustryType;
      allowDraft?: boolean;
      allowTrial?: boolean;
      allowDeprecated?: boolean;
    }
  ): RuleQueryResult {
    const defaultIndustry = options?.defaultIndustry || 'general';
    const allowDraft = options?.allowDraft || false;
    const allowTrial = options?.allowTrial || false;
    const allowDeprecated = options?.allowDeprecated || false;

    let targetIndustry = industry;
    let targetVersion = version;
    let fallbackReason: string | undefined;
    let statusFilterApplied = false;

    let industryRules = this.rules.get(targetIndustry);
    if (!industryRules || industryRules.size === 0) {
      fallbackReason = `行业 "${targetIndustry}" 未注册任何规则，回退至默认行业 "${defaultIndustry}"`;
      targetIndustry = defaultIndustry;
      industryRules = this.rules.get(targetIndustry);
    }

    if (!industryRules) {
      throw new Error(`无法找到任何规则配置，包括回退行业 "${defaultIndustry}"`);
    }

    const allVersions = Array.from(industryRules.keys()).sort((a, b) => b.localeCompare(a));

    const validVersions = allVersions.filter((v) => {
      const config = industryRules!.get(v)!;
      if (config.status === 'published') return true;
      if (config.status === 'trial' && allowTrial) return true;
      if (config.status === 'draft' && allowDraft) return true;
      if (config.status === 'deprecated' && allowDeprecated) return true;
      return false;
    });

    if (validVersions.length === 0) {
      throw new Error(
        `行业 "${targetIndustry}" 中没有符合状态过滤的可用规则，所有版本: ${allVersions.join(', ')}`
      );
    }

    if (!targetVersion) {
      const defaultV = this.defaultVersions.get(targetIndustry);
      if (defaultV && validVersions.includes(defaultV)) {
        targetVersion = defaultV;
      } else {
        targetVersion = validVersions[0];
      }
      statusFilterApplied = true;
      if (!version) {
        fallbackReason =
          fallbackReason || `使用行业 "${targetIndustry}" 的默认生效版本 "${targetVersion}" (${this.getStatusLabel(industryRules.get(targetVersion)!.status)})`;
      }
    }

    let config = industryRules.get(targetVersion);
    let isVersionValid = config ? this.isStatusAllowed(config.status, allowDraft, allowTrial, allowDeprecated) : false;

    if (!config || !isVersionValid) {
      const fallbackVersion = validVersions[0];
      const fallbackConfig = industryRules.get(fallbackVersion)!;
      statusFilterApplied = true;

      if (config && !isVersionValid) {
        fallbackReason = `版本 "${targetVersion}" 状态为 ${config.status}，不可用于评分，回退至 ${this.getStatusLabel(fallbackConfig.status)}版本 "${fallbackVersion}"`;
      } else {
        fallbackReason = `版本 "${targetVersion}" 不存在于行业 "${targetIndustry}"，回退至 ${this.getStatusLabel(fallbackConfig.status)}版本 "${fallbackVersion}"`;
      }

      targetVersion = fallbackVersion;
      config = fallbackConfig;
    }

    const isDefault = this.defaultVersions.get(targetIndustry) === targetVersion;
    const isLatest = validVersions[0] === targetVersion;

    return {
      config,
      isDefault,
      isLatest,
      fallbackReason,
      availableVersions: validVersions,
      statusFilterApplied,
    };
  }

  private isStatusAllowed(
    status: RuleStatus,
    allowDraft: boolean,
    allowTrial: boolean,
    allowDeprecated: boolean
  ): boolean {
    if (status === 'published') return true;
    if (status === 'trial' && allowTrial) return true;
    if (status === 'draft' && allowDraft) return true;
    if (status === 'deprecated' && allowDeprecated) return true;
    return false;
  }

  private getStatusLabel(status: RuleStatus): string {
    const labels: Record<RuleStatus, string> = {
      draft: '草稿',
      trial: '试运行',
      published: '已发布',
      deprecated: '已停用',
    };
    return labels[status];
  }

  public getRuleWithFallbackInfo(
    industry: IndustryType,
    version?: string,
    options?: {
      defaultIndustry?: IndustryType;
      allowDraft?: boolean;
      allowTrial?: boolean;
      allowDeprecated?: boolean;
    }
  ): { config: RegisteredIndustryConfig; fallbackInfo?: RuleFallbackInfo } {
    const result = this.getRule(industry, version, options);

    let fallbackInfo: RuleFallbackInfo | undefined;
    if (result.fallbackReason) {
      fallbackInfo = {
        requestedIndustry: industry,
        requestedVersion: version,
        fallbackIndustry: result.config.industry,
        fallbackVersion: result.config.version,
        reason: result.fallbackReason,
      };
    }

    return { config: result.config, fallbackInfo };
  }

  public getStatusHistory(industry: IndustryType, version: string): RuleStatusTransition[] {
    return this.statusHistory.get(industry)?.get(version) || [];
  }

  public listIndustries(): string[] {
    return Array.from(this.rules.keys());
  }

  public listVersions(industry: IndustryType, status?: RuleStatus): string[] {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return [];

    let versions = Array.from(industryRules.keys());
    if (status) {
      versions = versions.filter((v) => industryRules.get(v)!.status === status);
    }
    return versions.sort((a, b) => b.localeCompare(a));
  }

  public getAllRules(industry: IndustryType): RegisteredIndustryConfig[] {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return [];
    return Array.from(industryRules.values()).sort((a, b) => b.version.localeCompare(a.version));
  }

  public getPublishedRules(industry: IndustryType): RegisteredIndustryConfig[] {
    return this.getAllRules(industry).filter((r) => r.status === 'published');
  }

  public getDefaultVersion(industry: IndustryType): string | undefined {
    return this.defaultVersions.get(industry);
  }

  public hasRule(industry: IndustryType, version?: string, status?: RuleStatus): boolean {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return false;
    if (!version) return true;
    const config = industryRules.get(version);
    if (!config) return false;
    if (status) return config.status === status;
    return true;
  }

  public removeRule(industry: IndustryType, version: string): boolean {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return false;

    const existed = industryRules.delete(version);

    if (existed && this.defaultVersions.get(industry) === version) {
      const remainingVersions = Array.from(industryRules.keys()).sort((a, b) => b.localeCompare(a));
      if (remainingVersions.length > 0) {
        this.setDefaultVersion(industry, remainingVersions[0]);
      } else {
        this.defaultVersions.delete(industry);
        this.rules.delete(industry);
      }
    }

    if (existed) {
      this.statusHistory.get(industry)?.delete(version);
    }

    return existed;
  }

  public reset(): void {
    this.rules.clear();
    this.defaultVersions.clear();
    this.statusHistory.clear();
    this.initializeBuiltInRules();
  }

  public importRules(
    rules: Array<{
      industry: IndustryType;
      version: string;
      config: IndustryRequiredFieldsConfig;
      isDefault?: boolean;
      source?: 'custom' | 'override';
      status?: RuleStatus;
    }>
  ): void {
    for (const rule of rules) {
      if (this.hasRule(rule.industry, rule.version)) {
        this.overrideRule(rule.industry, rule.version, rule.config);
      } else {
        this.registerRule(rule.industry, rule.version, rule.config, {
          setAsDefault: rule.isDefault,
          source: rule.source,
          initialStatus: rule.status || 'draft',
        });
      }
    }
  }

  public exportRules(): Array<
    RegisteredIndustryConfig & { isDefaultVersion: boolean; statusHistory: RuleStatusTransition[] }
  > {
    const result: Array<
      RegisteredIndustryConfig & { isDefaultVersion: boolean; statusHistory: RuleStatusTransition[] }
    > = [];
    for (const [industry, versionMap] of this.rules.entries()) {
      const defaultV = this.defaultVersions.get(industry);
      for (const config of versionMap.values()) {
        result.push({
          ...config,
          isDefaultVersion: config.version === defaultV,
          statusHistory: this.getStatusHistory(industry, config.version),
        });
      }
    }
    return result;
  }
}
