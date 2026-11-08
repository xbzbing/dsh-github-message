<!-- 预发布 Release 正文的占位说明：stage / rc 的正文不归档到 docs/releases，发布后由 gh release edit 补上。
     release workflow 把下面安装命令里的尖括号占位符替换成本版后，直接用它建 prerelease。 -->

## 预发布

本版为预发布，只用于自测与隔离 profile 验证；完整变更记录由发布者随后补入本页。

```bash
# npm 的 stage 通道
dsh plugin --profile web add dsh-github-message@stage

# 或同一版本的 GitHub Release 附件
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/<TAG>/dsh-github-message-<VERSION>.tgz
```

---

## Pre-release

A pre-release for self-testing and isolated-profile verification only; its full change log is filled in on this page after publishing.

```bash
# The npm stage channel
dsh plugin --profile web add dsh-github-message@stage

# Or the same version as a GitHub Release asset
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/<TAG>/dsh-github-message-<VERSION>.tgz
```
