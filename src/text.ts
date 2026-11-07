// 外部文本的清洗与校验：GitHub 的标题、评论、仓库名都可能带换行、控制字符或超长内容。
// 信号层只处理清洗后的单行文本；链接只接受 github.com 的 https 地址。

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** 去控制字符（换行也算控制字符）、压空白、截断。 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 只接受 GitHub 页面链接；API 链接、javascript:、相对地址一律拒绝。 */
export function githubUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return undefined;
  return url.toString();
}

export const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const REPO_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** 校验 API 返回的 owner/repo（例如 repository.full_name）。 */
export function normalizeRepoForApi(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1 || value.indexOf('/', slash + 1) !== -1) return undefined;
  const owner = value.slice(0, slash);
  const name = value.slice(slash + 1);
  return REPO_PART_PATTERN.test(owner) && REPO_PART_PATTERN.test(name) ? value : undefined;
}

export function githubLogin(value: unknown): string | undefined {
  return typeof value === 'string' && LOGIN_PATTERN.test(value) ? value : undefined;
}

/** 从 `https://api.github.com/repos/owner/repo` 取 owner/repo；失败返回 undefined。 */
export function repoFromApiUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /\/repos\/([^/]+)\/([^/]+)\/?$/.exec(value);
  if (match?.[1] === undefined || match?.[2] === undefined) return undefined;
  if (!REPO_PART_PATTERN.test(match[1]) || !REPO_PART_PATTERN.test(match[2])) return undefined;
  return `${match[1]}/${match[2]}`;
}

/** 把仓库名拆成 owner、repo，并校验路径安全。 */
export function splitRepo(repo: string): { owner: string; name: string } | undefined {
  const slash = repo.indexOf('/');
  if (slash <= 0 || slash === repo.length - 1) return undefined;
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  if (!REPO_PART_PATTERN.test(owner) || !REPO_PART_PATTERN.test(name)) return undefined;
  return { owner, name };
}

/** 事件键里的仓库名统一小写，避免大小写差异造成重复提醒。 */
export function repoKey(repo: string): string {
  return repo.toLowerCase();
}

export function isoToMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** 把毫秒时间格式化成 GitHub search 的日期限定（UTC，精确到天）。 */
export function searchDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
