# dsh-github-message

English | [简体中文](https://github.com/xbzbing/dsh-github-message/blob/main/README.md)

`dsh-github-message` is a message-source plugin for [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/dsh):
it polls GitHub read-only through the local `gh` CLI and turns "PRs waiting for my review", "new issues in the
repositories I maintain" and "@mentions" into `my-superagent/v1` signals for
[dsh-my-superagent](https://github.com/xbzbing/dsh-my-superagent) to decide whether to interrupt the owner.

The plugin only does **collect → translate → report**. Reviewing, issue analysis, comment write-back and whether to
notify are all handled by Superagent — this repository contains no code that writes to GitHub. When Superagent is not
installed, the plugin keeps polling and shows new messages in the bottom-right corner instead.

## Install

```bash
# Stable (npm)
dsh plugin --profile web add dsh-github-message@latest

# Pre-release (the npm stage channel, versions look like 0.1.0-stage.0)
dsh plugin --profile web add dsh-github-message@stage

# Or a specific version as a GitHub Release asset
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/v0.1.0/dsh-github-message-0.1.0.tgz
```

`lib/` is not committed, so `dsh plugin add github:…` does not work — install from npm or a Release asset.

After installing, open **Settings → Plugins → GitHub Messages**: make sure "GitHub login" is green (`gh auth status`),
then fill in the repositories to watch. The source is off by default; enable `github-message` on Superagent's Sources page.

Client-only updates take effect after a page refresh; versions with host changes need the plugin reinstalled
(`dsh plugin remove`, then `add`), plus a dsh restart when the profile does not enable HMR.

## Requirements

- The [GitHub CLI](https://cli.github.com/) is installed and signed in: `gh auth status` passes.
- `@` mentions need the `notifications` scope; without it the plugin falls back to search and the panel suggests
  `gh auth refresh -s notifications`.
- To report to Superagent, `dsh-my-superagent` must declare `github-source` (P1 is implemented). An older core falls
  back to dry-run: collect only, no reporting.
- Compatibility: verified on `dsh@0.2.2-rc.1`; Node.js ≥ 24.9 (the plugin runs inside the dsh process).

## Features

- **Review requests**: open PRs from `review-requested:@me`, deduplicated by head commit; a new commit on the same PR
  is a new fact.
- **New issues**: by default only for repositories in the watch list; with `issueScope: owned`, also covers all
  repositories owned by the current account (`user:@me`) plus the organizations listed in `orgs`. Reported once by
  creation time.
- **@ mentions**: via Notifications (`reason=mention|team_mention`), falling back to `mentions:@me` search;
  deduplicated by comment id.
- **Polling cadence**: 5 minutes by default, configurable from 1 minute to 24 hours; the effective delay is the larger
  of the configured interval and GitHub's `X-Poll-Interval`, with exponential backoff (up to 30 minutes) on failures and
  a wait until `X-RateLimit-Reset` when rate limited.
- **Local notices**: without Superagent, new messages pop up in the bottom-right corner (at most 4 cards, 12 seconds,
  click through to GitHub). Each fact is shown once and recorded in `notified.json`, never in `seen`, so connecting the
  core later still reports it.
- **Settings page**: login state, core capability, repository/organization lists, issue scope and interval (one shared
  save button), per-stream stats and core signals; cards collapse.
- **Bilingual**: follows the DSH language setting.

## Signal contract

| kind | subject | sourceEventId | Trigger |
| --- | --- | --- | --- |
| `code-review.requested` | `github:<owner>/<repo>/pull/<n>` | `review:<repo>#<n>:<headSha>` | A PR requests my (or my team's) review |
| `github.issue.opened` | `github:<owner>/<repo>/issues/<n>` | `issue:<repo>#<n>` | A watched, owned or organization repository gets a new issue |
| `github.mention` | `github:<owner>/<repo>/issues/<n>` | `mention:<repo>#<n>:<commentId\|body>` | Someone mentions me or my team |

- `repo` is lower-cased in event keys; display keeps the casing GitHub returns.
- All external text has control characters removed, whitespace collapsed and fields truncated; links must be
  `https://github.com/...`.
- `payload` carries only routing/display fields — never raw API responses, diffs, e-mail addresses or tokens.
- The plugin registers with `trust: 'external'`; the core only accepts a signal after verifying it at the source.

## Permissions and data boundaries

- **Read-only GitHub**: only `gh api` GET / search / notifications. There is no POST/PATCH/PUT/DELETE in the code, and
  no `gh pr review`, `gh pr comment` or `gh issue comment`.
- **No credentials**: the plugin never reads, writes or logs a token; `gh` uses its own keyring and child processes get
  a minimal environment without `GH_TOKEN` / `GITHUB_TOKEN`.
- **No write-back**: no review, no comment, no merge, no push. Reviewing and issue analysis belong to Superagent.
- **Local files**: only the plugin's own data directory (`$DSH_HOME/dsh-github-message/`: `seen.json`,
  `notified.json`, `stats.json`, `config.json`, `poll.log`), mode 0700/0600.
- **Core database**: the "core signals" panel section only reads `$DSH_HOME/dsh-my-superagent/state.sqlite` for
  statistics and degrades gracefully when it is unavailable.

## Configuration

Defaults live in `cordis.patch.yml` and `src/config.ts`. Override them in the profile's `cordis.patch.yml` under the same
id (patch `config` replaces the whole object, so repeat every key you want to keep):

```yaml
- id: dsh-github-message
  name: dsh-github-message
  config:
    intervalMs: 300000
    windowMs: 604800000
    issueScope: owned
    repos:
      - xbzbing/dsh-my-superagent
    orgs:
      - my-org
    mentionMode: notifications
```

| Key | Default | Description |
| --- | --- | --- |
| `intervalMs` | `300000` (5 min) | Poll interval; 60 s to 24 h. The effective delay is the larger of this and GitHub `X-Poll-Interval` |
| `windowMs` | `604800000` (7 days) | First-run and filter window for review/issue/mention; `0` disables filtering |
| `repos` | `[]` | Watched repositories, `owner/repo`; the issue stream needs at least one when `issueScope=repos` |
| `issueScope` | `repos` | `repos` only queries the watch list; `owned` also queries `user:@me` and `orgs`, keeping the watch list |
| `orgs` | `[]` | Organization names; only used when `issueScope=owned`, one `org:<name>` query each |
| `maxRepos` | `10` | Repositories per poll (1–10) |
| `maxOrgs` | `10` | Organizations per poll (1–10) |
| `maxResults` | `100` | Items per stream per poll (1–100) |
| `maxPages` | `3` | Search pages per stream (1–10) |
| `includeDrafts` | `true` | Whether draft PRs are reported |
| `mentionMode` | `notifications` | `notifications` / `search` / `off` |
| `timeoutMs` | `20000` | Timeout for one `gh` call |
| `cliPath` | `gh` | Overridable with `DSH_GITHUB_CLI` |
| `onStart` | `true` | Poll immediately after the plugin loads |
| `stateFile` | `$DSH_HOME/dsh-github-message/seen.json` | Dedup state; `false` keeps it in memory |
| `notifiedFile` | `$DSH_HOME/dsh-github-message/notified.json` | Local-notice ledger, separate from dedup; `false` keeps it in memory |
| `seenTtlMs` | `7776000000` (90 days) | Retention for dedup and notice records |
| `seenMaxEntries` | `20000` | Cap for dedup and notice records |
| `logFile` | `$DSH_HOME/dsh-github-message/poll.log` | Per-poll summary; `false` disables it |
| `statsFile` | `$DSH_HOME/dsh-github-message/stats.json` | Accumulated stats; `false` keeps them in memory |
| `runtimeConfigFile` | `$DSH_HOME/dsh-github-message/config.json` | Runtime config saved by the panel; `false` disables persistence |

The interval, watch list, issue scope and organization list saved from the panel go to `config.json` and **win over** the
Cordis patch; delete that file to fall back to the patch defaults.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test "test/**/*.test.ts"
npm run build       # tsc host + esbuild client → lib/
npm run check       # typecheck + test + build
npm run smoke       # real read-only smoke (queries only)
```

- Design notes live in [docs/plan](docs/plan/), decisions in [docs/adr](docs/adr/), and the core-side proposal in
  [dsh-my-superagent issue #1](https://github.com/xbzbing/dsh-my-superagent/issues/1).
- Tests use a fake `gh` and a fake SourceService and never touch real GitHub; new behaviour needs tests.

## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs when a version bump lands on main:

1. gate: `npm ci` → `npm run check` → `npm pack` → `scripts/assert-pack.mjs`;
2. tag `v<version>`;
3. `npm publish --provenance --tag <latest|stage|rc>` (stable goes to `latest`, pre-releases to their own dist-tag);
4. create the GitHub Release with the same `.tgz`. A stable body comes from `docs/releases/v<version>.md`; a
   pre-release page starts from `.github/PRERELEASE_BODY.md` and gets its full changelog via `gh release edit` later.

The body format is defined in [`.github/RELEASE_TEMPLATE.md`](.github/RELEASE_TEMPLATE.md). npm publishing uses
Trusted Publishing (OIDC) by default: register `release.yml` as a trusted publisher in the package settings on
npmjs.com and the repository needs no `NPM_TOKEN`.

`package.json` and `PLUGIN_VERSION` in `src/constants.ts` must be bumped together; `test/version.test.ts` fails when
they drift.

## License

[MIT](LICENSE)
