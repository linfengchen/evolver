# Release Workflow (evolver)

> 本文档记录 evolver 的完整发版流程。基于 2026-04 v1.70.0 promote 实操沉淀。
> 适用对象：evolver-private-dev 的维护者。本文在 public.manifest.json 的 `docs/**` 排除列表中，不会随 dist-public 发布。

---

## 总览

evolver 目前走双通道发版：

| 通道 | npm dist-tag | GitHub Release 状态 | 获取方式 |
|------|--------------|----------------------|----------|
| Stable（正式版） | `latest` | Latest | `npm i -g @evomap/evolver@latest`（缺省） |
| Beta（测试版） | `beta` / `rc` / `alpha` / `next` / `canary` | Pre-release | `npm i -g @evomap/evolver@beta` |

版本号语义严格遵循 SemVer 2.0：含 `-` 即 prerelease。发版入口是 `scripts/deploy.sh`，它会根据版本号自动判定通道。不要手工绕过 `deploy.sh` 去分别跑 `build_public.js` / `publish_public.js` / `npm publish`——1.70.0 之前的历史坑（beta 被误标 Latest、npm latest 被 beta 污染）都来自手工组装。

---

## 五个标准场景

### 场景 1：Stable patch/minor/major

最常见的流程。在 main 分支上，修完一批 bug/enhancement 后：

```bash
./scripts/deploy.sh patch     # 1.70.0 -> 1.70.1
./scripts/deploy.sh minor     # 1.70.1 -> 1.71.0
./scripts/deploy.sh major     # 1.71.0 -> 2.0.0
```

**注意**：如果当前版本是 prerelease（例如 `1.70.1-beta.0`），`patch` 不会 bump Z，而是 **promote 到同基线的 stable**（`1.70.1-beta.0` → `1.70.1`）。这是设计目的：beta 跑完一轮后直接一条命令发正式版。

### 场景 2：Beta / RC / Alpha（预发布）

启动新的 beta 线时，显式指定版本号，含 `-` 即自动切换到 prerelease 通道：

```bash
./scripts/deploy.sh 1.71.0-beta.0    # npm dist-tag: beta, GitHub: Pre-release
./scripts/deploy.sh 1.71.0-beta.1    # 后续迭代
./scripts/deploy.sh 1.71.0-beta.2
./scripts/deploy.sh 2.0.0-rc.1       # RC 通道
./scripts/deploy.sh 1.72.0-alpha.0   # Alpha 通道
```

prerelease 通道下，deploy.sh **自动**：

- 将 GitHub Release 标为 `Pre-release`（通过 `gh release edit --prerelease`，修掉 publish_public.js 不设此 flag 的历史坑）
- 将 npm dist-tag 设为 label（`beta` / `rc` / `alpha` / `next` / `canary`），**不会**碰 `latest`
- Skip 本地 `skills/evolver/` 部署（保留你机器上跑的是 stable 版本）
- Skip `feishu-evolver-wrapper` 重启（wrapper 长跑在 latest 上，不受 beta 污染）

如果确实想让本地和 wrapper 也切到 beta（例如自测），加 `--promote-local`。

### 场景 3：Beta 晋级到 Stable

两种子场景，取决于 beta 线的内容是否**全部**都要进 stable。

#### 3a. 整条 beta 线都要进 stable

beta.0..beta.N 积累的改动都通过了验证，直接让 `patch` 的 promote 语义帮你升版：

```bash
git checkout main
# 确认当前 package.json 版本是 1.70.1-beta.N
./scripts/deploy.sh patch --notes-file=/tmp/release-notes.md
# 上述命令会把 package.json 从 1.70.1-beta.N -> 1.70.1，发 stable
```

#### 3b. 只有 beta 线的一部分能进 stable（v1.70.0 promote 的实操）

主分支已经堆了 `beta.0 / 1 / 2 / 3 / 4 / 5`，但只有 `beta.0 / 1 / 2 / 4` 充分验证过，`beta.3` 和 `beta.5` 还需要继续浸泡。这时需要开一条 release branch，cherry-pick 过关的 commits：

```bash
# 1. 找到上一个 stable 的 commit 作为基点
git log --oneline --grep="chore(release): prepare v1.69.21"
# 假设得到 140f329

# 2. 从基点开一条 release branch
git checkout -b release/1.70.0 140f329

# 3. Cherry-pick 过关的 beta commits
git cherry-pick <beta.0 sha> <beta.1 sha> <beta.2 sha> <beta.4 sha>
#    如果遇到 package.json 冲突，保留 --ours 即可（后面会统一 bump）

# 4. 发正式版，声明 source-branch
./scripts/deploy.sh 1.70.0 --source-branch=release/1.70.0 --notes-file=/tmp/release-notes.md

# 5. 把 release branch 推到 origin 作为审计记录
git push origin release/1.70.0

# 6. 打 tag 指向 release branch 的 HEAD（让 main 和 tag 同时可见）
git tag v1.70.0 <release/1.70.0 HEAD sha>
git push origin v1.70.0

# 7. 回到 main，把版本号 bump 到 1.70.1-beta.0（表明 beta.3/5 的内容将落到 1.70.1）
git checkout main
# 手工编辑 package.json: version -> "1.70.1-beta.0"
git commit -am "chore(version): bump main to 1.70.1-beta.0"
git push origin main
```

**注意**：这个方案不会删除 main 上的 beta.3 和 beta.5 代码，它们继续走 beta 通道；下一轮 `1.70.1-beta.X` 会基于 main 继续迭代，直到 beta.3 和 beta.5 的功能也验证过，再按场景 3a 的方式 promote 到 `1.70.1`。

### 场景 4：Hotfix Backport

线上 stable 出了安全问题，但 main 已经跑在 beta 线上，无法从 main 直接发 stable patch：

```bash
# 1. 从上一个 stable tag 开 hotfix branch
git checkout -b hotfix/1.69.x 140f329

# 2. 在 hotfix branch 上修问题，commit

# 3. 发 hotfix patch
./scripts/deploy.sh 1.69.22 --source-branch=hotfix/1.69.x --notes-file=/tmp/hotfix-notes.md
```

Hotfix 发完后，**必须**把相同的修复 cherry-pick 到 main，确保 main 的下一个 beta 也包含该修复。

### 场景 5：Dry Run 预览

任何场景都可以前置 `--dry-run` 先看一眼：

```bash
./scripts/deploy.sh 1.70.1-beta.3 --dry-run
```

会 echo 出每一步 shell 命令（包括 publish_public.js 的完整 env），不执行任何写入。这是每次发版前最低成本的自检。

---

## 脚本做了什么（8 个 step）

| Step | 动作 | Stable | Prerelease |
|------|------|--------|------------|
| 0 | Preflight：gh auth / npm auth / branch match / tag unused / notes file exists | ✓ | ✓ |
| 1 | Bump `package.json` version | ✓ | ✓ |
| 2 | `git add -A && git commit && git push origin <source-branch>` | ✓ | ✓ |
| 3 | `RELEASE_VERSION=<new> node scripts/build_public.js` | ✓ | ✓ |
| 4 | 清空 `../skills/evolver/` 并拷贝 `dist-public/` 内容 | ✓ | skipped |
| 5 | `publish_public.js` 推公开仓库 + 建 GitHub Release；若 prerelease 则 `gh release edit --prerelease` | ✓ | ✓ |
| 6 | `cd dist-public && npm publish --access public --tag <dist-tag>` | ✓（`latest`） | ✓（`beta`/`rc`/…） |
| 7 | 验证 GitHub release 状态 + npm dist-tag 与预期一致 | ✓ | ✓ |
| 8 | 重启 `feishu-evolver-wrapper` | ✓ | skipped |

每一步都 honor `--dry-run`。Step 0 的任何一项失败整个脚本立即退出；step 5/6 失败只打 WARN 不中断，因为多数失败（tag 已存在、npm 未登录）用户自己能马上看到并手工补救。

---

## 常用 flag 速查

| Flag | 作用 |
|------|------|
| `--dry-run` | 预览，不执行任何写入 |
| `--source-branch=<branch>` | 从指定分支发（hotfix / release 分支） |
| `--notes-file=<path>` | GitHub Release notes 从文件读（推荐 beta 和 promote 用） |
| `--skip-wrapper` | 不重启 feishu-evolver-wrapper（prerelease 自动开启） |
| `--skip-deploy-skills` | 不更新本地 `../skills/evolver/`（prerelease 自动开启） |
| `--promote-local` | prerelease 下强制本地部署 + wrapper 重启，用于自测 |

---

## 历史坑位与修复

| 坑 | 时间 | 修复位置 |
|---|---|---|
| beta.3 / beta.4 被 GitHub 误标 Latest | pre-2026-04-27 | deploy.sh step 5 自动 `gh release edit --prerelease` |
| 手工 `npm publish` 漏了 `--tag beta`，latest 指向 beta | pre-2026-04-27 | deploy.sh step 6 从版本号 label 自动推导 dist-tag |
| `publish_public.js` 硬编码检查 `expected=main` 导致 release branch 发版被拒 | v1.70.0 promote | deploy.sh step 5 通过 `SOURCE_BRANCH` env var 传递 |
| `build_public.js` 的 semver 自动推断把 1.70.0 推成 1.70.1 | v1.70.0 promote | deploy.sh step 3 用 `RELEASE_VERSION` 强制钉版本 |
| cherry-pick 时 `package.json` 冲突中断流程 | v1.70.0 promote | 流程文档化：冲突时 `git checkout --ours package.json && git cherry-pick --continue` |
| `deploy.sh patch` 从 beta 状态出发算出 1.70.2 而非 1.70.1 | 2026-04-27 本次修复 | deploy.sh 的版本计算：当前是 prerelease 时 patch = drop prerelease |

---

## Release Notes Redaction

`scripts/publish_public.js` 不会自动 redact。写 release notes 时人工把涉及以下内容的描述替换为 `Internal improvements and stability enhancements.`：

- 任何 obfuscation / anti-tamper / integrity check / anti-debug 的实现细节
- 任何 license enforcement / offline permit / node_id 绑定机制的内部描述
- 任何 validator sandbox 的具体 allowlist（例如 "removed npm/npx"——这是 security advisory，应该通过 GHSA 公布，而非 release notes 正文）

**什么能写**：对外语义变化、API 变化、用户可见的行为变化、GHSA 编号引用（链接到 GitHub Security tab，由其自动 redact 实现细节）、社区 PR 致谢。

---

## 依赖工具

| 工具 | 用途 | 认证 |
|------|------|------|
| `gh` CLI | 创建 Release、编辑 prerelease flag、查询 release 状态 | `gh auth login` |
| `npm` | 发 npm 包 | `npm login`，检查 `npm whoami` |
| `git` | 分支、tag、push | 已配置 SSH key 到 `github.com:EvoMap/*` |
| `node` | build_public + publish_public | 随 evolver-private-dev 仓库 |

Preflight step 0 会自动检测前三项，不通过就拒绝继续。

---

## 相关文件

| 路径 | 作用 |
|------|------|
| `scripts/deploy.sh` | 发版主入口（本文档对应的脚本） |
| `scripts/build_public.js` | 生成 `dist-public/`，含 obfuscation + integrity manifest |
| `scripts/publish_public.js` | 推公开仓库 + 建 GitHub Release |
| `public.manifest.json` | 哪些文件进 public dist，哪些排除 |
| `scripts/pre_publish_check.js` | `publish_public.js` 自带的 test-suite + 模块验证门 |
| `.cursor/rules/0-deploy-workflow.mdc`（workspace） | Cursor agent 发版规则，含 redaction 要求 |
| `.cursor/rules/14-pre-publish-leak-guard.mdc`（workspace） | 敏感内容扫描清单 |
