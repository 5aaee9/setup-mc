# Setup mc

Install the [PGSTY-maintained MinIO client](https://github.com/pgsty/mc) in GitHub Actions. The fork ships as `mcli`; this action exposes both `mc` and `mcli` so existing commands keep working.

PGSTY maintains the server in [pgsty/silo](https://github.com/pgsty/silo) and its companion client in [pgsty/mc](https://github.com/pgsty/mc). This action installs the client only. The former `dl.min.io` client download endpoint now returns HTTP 410 Gone.

```yaml
- uses: actions/checkout@v4
- uses: ./ # Or the published reference for this action
  with:
    version: latest
- run: mc --version
```

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `version` | `latest` | A release from `pgsty/mc`, e.g. `2026-09-16T00-00-00Z` or `RELEASE.2026-09-16T00-00-00Z`. |
| `github-token` | `${{ github.token }}` | Token for GitHub release metadata. `GITHUB_TOKEN` in the environment is also accepted. |

If GitHub rejects the supplied token with HTTP 401, the action retries the public release lookup once without authentication. Anonymous API requests have a lower rate limit; if that limit is reached, supply a valid GitHub token.

Historical upstream MinIO versions are not automatically mapped to PGSTY releases. Pick a tag available in [PGSTY's releases](https://github.com/pgsty/mc/releases).

Linux, macOS and Windows are supported on amd64 and arm64. Archives are checked against the GitHub asset SHA-256 digest, or the release checksum manifest when a digest is unavailable. Each resolved release has a separate tool-cache entry; `latest` is resolved on each invocation.

To validate changes locally:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Commit the rebuilt `dist/index.js` with source changes: GitHub Actions runs that bundle directly.
