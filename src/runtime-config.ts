// 面板修改的运行时配置。只持久化用户能改的字段，Cordis patch 仍是其余配置的来源。

import { ISSUE_SCOPES, PR_SCOPES, normalizeOrg, normalizeRepo, type IssueScope, type PrScope } from './config.ts';
import { readJsonFile, writeJsonFile, type FileLogger } from './json-file.ts';

export interface RuntimeConfigFile {
  intervalMs?: number;
  repos?: string[];
  issueScope?: IssueScope;
  prScope?: PrScope;
  orgs?: string[];
}

export function loadRuntimeConfig(file: string | undefined, logger?: FileLogger): RuntimeConfigFile {
  const raw = readJsonFile(file, logger);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const result: RuntimeConfigFile = {};
  if (typeof value.intervalMs === 'number' && Number.isFinite(value.intervalMs) && value.intervalMs > 0) {
    result.intervalMs = value.intervalMs;
  }
  if (Array.isArray(value.repos)) {
    const repos: string[] = [];
    for (const item of value.repos) {
      const repo = normalizeRepo(item);
      if (repo !== undefined) repos.push(repo);
    }
    result.repos = repos;
  }
  if (typeof value.issueScope === 'string') {
    const scope = ISSUE_SCOPES.find((candidate) => candidate === value.issueScope);
    if (scope !== undefined) result.issueScope = scope;
  }
  if (typeof value.prScope === 'string') {
    const scope = PR_SCOPES.find((candidate) => candidate === value.prScope);
    if (scope !== undefined) result.prScope = scope;
  }
  if (Array.isArray(value.orgs)) {
    const seen = new Set<string>();
    const orgs: string[] = [];
    for (const item of value.orgs) {
      const org = normalizeOrg(item);
      if (org === undefined) continue;
      const key = org.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      orgs.push(org);
    }
    result.orgs = orgs;
  }
  return result;
}

export function saveRuntimeConfig(file: string | undefined, values: RuntimeConfigFile, logger?: FileLogger): void {
  writeJsonFile(file, { version: 1, ...values }, logger);
}
