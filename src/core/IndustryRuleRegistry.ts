import {
  IndustryType,
  IndustryRequiredFieldsConfig,
  RegisteredIndustryConfig,
  RuleQueryResult,
  RuleFallbackInfo,
} from '../types';
import { INDUSTRY_REQUIRED_FIELDS } from '../config';

export class IndustryRuleRegistry {
  private rules: Map<string, Map<string, RegisteredIndustryConfig>> = new Map();
  private defaultVersions: Map<string, string> = new Map();
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
      };
      this.storeRule(industry, registeredConfig);
      this.defaultVersions.set(industry, registeredConfig.version);
    }
  }

  private storeRule(industry: string, config: RegisteredIndustryConfig): void {
    if (!this.rules.has(industry)) {
      this.rules.set(industry, new Map());
    }
    this.rules.get(industry)!.set(config.version, config);
  }

  public registerRule(
    industry: IndustryType,
    version: string,
    config: IndustryRequiredFieldsConfig,
    options?: {
      setAsDefault?: boolean;
      source?: 'custom' | 'override';
    }
  ): RegisteredIndustryConfig {
    const existing = this.rules.get(industry)?.get(version);
    if (existing) {
      throw new Error(`规则已存在：行业=${industry}, 版本=${version}, 请使用 updateRule() 更新`);
    }

    const registeredConfig: RegisteredIndustryConfig = {
      ...config,
      version,
      industry,
      registeredAt: new Date().toISOString(),
      isDefault: options?.setAsDefault === true,
      source: options?.source || 'custom',
    };

    this.storeRule(industry, registeredConfig);

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
      registeredAt: new Date().toISOString(),
    };

    this.storeRule(industry, updated);
    return updated;
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
    defaultIndustry: IndustryType = 'general'
  ): RuleQueryResult {
    let targetIndustry = industry;
    let targetVersion = version;
    let fallbackReason: string | undefined;
    let requestedIndustry = industry;
    let requestedVersion = version;

    let industryRules = this.rules.get(targetIndustry);
    if (!industryRules || industryRules.size === 0) {
      fallbackReason = `行业 "${targetIndustry}" 未注册任何规则，回退至默认行业 "${defaultIndustry}"`;
      targetIndustry = defaultIndustry;
      industryRules = this.rules.get(targetIndustry);
    }

    if (!industryRules) {
      throw new Error(`无法找到任何规则配置，包括回退行业 "${defaultIndustry}"`);
    }

    const availableVersions = Array.from(industryRules.keys()).sort((a, b) => b.localeCompare(a));

    if (!targetVersion) {
      targetVersion = this.defaultVersions.get(targetIndustry) || availableVersions[0];
      if (!version && requestedIndustry !== targetIndustry) {
        fallbackReason = fallbackReason || `使用行业 "${targetIndustry}" 的默认生效版本 "${targetVersion}"`;
      }
    }

    let config = industryRules.get(targetVersion);
    if (!config) {
      const latestVersion = availableVersions[0];
      fallbackReason = `版本 "${targetVersion}" 不存在于行业 "${targetIndustry}"，回退至最新版本 "${latestVersion}"`;
      targetVersion = latestVersion;
      config = industryRules.get(targetVersion)!;
    }

    const isDefault = this.defaultVersions.get(targetIndustry) === targetVersion;
    const isLatest = availableVersions[0] === targetVersion;

    return {
      config,
      isDefault,
      isLatest,
      fallbackReason,
      availableVersions,
    };
  }

  public getRuleWithFallbackInfo(
    industry: IndustryType,
    version?: string,
    defaultIndustry: IndustryType = 'general'
  ): { config: RegisteredIndustryConfig; fallbackInfo?: RuleFallbackInfo } {
    const result = this.getRule(industry, version, defaultIndustry);

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

  public listIndustries(): string[] {
    return Array.from(this.rules.keys());
  }

  public listVersions(industry: IndustryType): string[] {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return [];
    return Array.from(industryRules.keys()).sort((a, b) => b.localeCompare(a));
  }

  public getAllRules(industry: IndustryType): RegisteredIndustryConfig[] {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return [];
    return Array.from(industryRules.values()).sort((a, b) => b.version.localeCompare(a.version));
  }

  public getDefaultVersion(industry: IndustryType): string | undefined {
    return this.defaultVersions.get(industry);
  }

  public hasRule(industry: IndustryType, version?: string): boolean {
    const industryRules = this.rules.get(industry);
    if (!industryRules) return false;
    if (!version) return true;
    return industryRules.has(version);
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

    return existed;
  }

  public reset(): void {
    this.rules.clear();
    this.defaultVersions.clear();
    this.initializeBuiltInRules();
  }

  public importRules(rules: Array<{
    industry: IndustryType;
    version: string;
    config: IndustryRequiredFieldsConfig;
    isDefault?: boolean;
    source?: 'custom' | 'override';
  }>): void {
    for (const rule of rules) {
      this.registerRule(rule.industry, rule.version, rule.config, {
        setAsDefault: rule.isDefault,
        source: rule.source,
      });
    }
  }

  public exportRules(): Array<RegisteredIndustryConfig & { isDefaultVersion: boolean }> {
    const result: Array<RegisteredIndustryConfig & { isDefaultVersion: boolean }> = [];
    for (const [industry, versionMap] of this.rules.entries()) {
      const defaultV = this.defaultVersions.get(industry);
      for (const config of versionMap.values()) {
        result.push({
          ...config,
          isDefaultVersion: config.version === defaultV,
        });
      }
    }
    return result;
  }
}
