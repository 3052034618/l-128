import { DetailLogEntry } from '../types';
import { MAX_DETAIL_LOG_ENTRIES } from '../config';

export class DetailLogger {
  private logs: DetailLogEntry[] = [];
  private enabled: boolean;
  private maxEntries: number;

  constructor(enabled: boolean = false, maxEntries: number = MAX_DETAIL_LOG_ENTRIES) {
    this.enabled = enabled;
    this.maxEntries = maxEntries;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private addLog(
    level: DetailLogEntry['level'],
    module: string,
    message: string,
    data?: any
  ): void {
    if (!this.enabled) return;

    if (this.logs.length >= this.maxEntries) {
      this.logs.shift();
    }

    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    });
  }

  info(module: string, message: string, data?: any): void {
    this.addLog('info', module, message, data);
  }

  warn(module: string, message: string, data?: any): void {
    this.addLog('warn', module, message, data);
  }

  error(module: string, message: string, data?: any): void {
    this.addLog('error', module, message, data);
  }

  debug(module: string, message: string, data?: any): void {
    this.addLog('debug', module, message, data);
  }

  getLogs(): DetailLogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  getLogsByLevel(level: DetailLogEntry['level']): DetailLogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  getLogsByModule(module: string): DetailLogEntry[] {
    return this.logs.filter((log) => log.module === module);
  }
}
