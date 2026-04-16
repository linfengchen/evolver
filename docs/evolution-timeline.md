# Evolver 迭代轨迹全记录

> 基于 evolver-private-dev 仓库 888 个 commit (含所有分支)、117 个版本发布的完整 git 历史重建。
> 所有时间戳基于 git 元数据，可独立验证。

---

## 概览

| 指标 | 数值 |
|------|------|
| 总 commit 数 | 888 (含所有分支; main 分支 430) |
| 版本发布数 | 117 (v1.0.29 ~ v1.66.0) |
| 时间跨度 | 2026-01-31 ~ 2026-04-15 (75 天) |
| 核心代码量 | 23,062 行 (src/) |
| GEP 引擎代码 | 15,824 行 (src/gep/) |
| 主进化循环 | 2,531 行 (src/evolve.js) |
| 贡献者 | 10+ (含社区 PR 贡献者) |
| 社区 PR 合并 | 17+ 次 |
| 月 commit 分布 | 1月: 9, 2月: 585, 3月: 181, 4月: 113 |

---

## 第一阶段: 原型诞生 (2026-01-31 ~ 2026-02-03)

**核心事件**: 从 Feishu Bot 生态中诞生了自进化的原型概念

这一阶段的 commit 全部带有 `PCEC Cycle Complete` 或 `Evolution:` 前缀，说明 evolver 最初是从一个真实运行的 AI Agent 生态系统中自然生长出来的，不是从零设计的。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 01-31 | `da6a194` | Initial commit: Base workspace state with skills |
| 01-31 | `59f3b4b` | Add README with mission and capabilities |
| 02-01 | `e85ed5e` | PCEC Cycle Complete: Quantum Catgirl Mutation |
| 02-01 | `7e6ca66` | Evolution: Self-Awareness Upgrade (Log Reading) |
| 02-01 | `653e373` | Initial evolution snapshot (v1.0.0) |
| 02-01 | 303 commits | 大量 `Evolution:` 前缀的自动进化 commit |
| 02-01 | `7380485` | Evolution: Adaptive Stability Logic in capability-evolver |
| 02-01 | `33fb4ec` | Evolution: Atomic Writes in feishu-card v1.4.1 |
| 02-01 | `3d4f321` | Evolution: Memory Manager Atomic Lock (Cycle #6208) |
| 02-01 | `e4dca55` | Evolution: ArXiv Watch Mode (Cycle #2941) |
| 02-02 | `e73cbb4` | fix: remove all recursive logic and pcec-feishu calls |
| 02-03 | `b823bf1` | feat: rename capability-evolver to evolver & decoupling |
| 02-03 | `789dcc5` | feat: v2.0 Ascension Protocol - Knowledge Base & Skill Incubation |

### 论据意义

1. **原始名称为 PCEC (Perceive-Cognize-Evolve-Commit)**，后来演变为 GEP。这个术语演变有完整 git 轨迹。
2. **Cycle 编号** (如 #6208, #2941, #5232) 证明进化引擎已经运行了数千次循环。
3. **303 个 Evolution 前缀 commit** 在一天内产生，因为这些是自动进化产生的，不是人手写的。这证明自进化机制在开源前就已经在真实环境中运行。
4. **Atomic Writes 模式** 在 v1.0 阶段就出现了 (`33fb4ec`)，这个跨语言设计模式后来也出现在 Hermes Agent 中。

---

## 第二阶段: GEP 协议成型 (2026-02-04 ~ 2026-02-09)

**核心事件**: PCEC 正式重构为 GEP (Genome Evolution Protocol)，奠定了整套自进化架构的基因系统

这是 Evolver 架构史上最密集的一周，6 天发布了从 v1.1.0 到 v1.9.2 共 29 个版本。每一个核心模块都在这一周内初次登场。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 02-04 | `cd5f09b` | Refactor evolver to use GEP protocol with structured assets |
| 02-04 | `03dea09` | feat: persist capability candidates and enforce prompt budget |
| 02-04 | `ae09a7b` | feat: add public build pipeline |
| 02-06 | `73c59eb` | feat: add memory graph causal evolution |
| 02-06 | `a6574b6` | feat: memory graph v2 + A2A exchange; bump to v1.2.0 |
| 02-06 | `67aaea0` | feat(gep): add mutation protocol and personality evolution |
| 02-06 | `08baf7b` | feat(security): add validation command safety check (v1.4.4) |
| 02-07 | `e5536ec` | feat(gep): content addressing, env fingerprint, validation report, A2A protocol (v1.5.0) |
| 02-07 | `08bdf12` | feat(gep): innovation signal detection and auto-innovate mutation (v1.6.0) |
| 02-07 | `becf042` | feat(test): containerized vibe testing framework and daemon loop (v1.5.1) |
| 02-07 | `67ae241` | feat(evolver): add internal daemon loop with suicide guard |
| 02-09 | `ad79609` | feat(gep): v1.8.0 - evolved protocol with innovation mandate |
| 02-09 | `38a00e2` | feat: signal dedup + singleton guard + envFingerprint (v1.9.1) |

### 论据意义

1. **GEP 协议从 PCEC 演变而来** (`03a48c5` 在 02-28 完成了术语替换)，整个演变过程有中间状态，不是一次性设计的。
2. **Memory Graph v1 到 v2 的升级** 在两天内完成 (02-06)，说明团队在实际运行中发现了因果推理的需求，这是渐进式设计的铁证。
3. **Vibe 测试框架** 在 v1.5.1 引入，说明团队在核心架构刚成型时就建立了质量保证体系。
4. **28 个版本在 6 天内发布**，平均每天 4.7 个版本。这种迭代密度只有在真实运行环境中持续发现问题、持续修复才可能产生。

---

## 第三阶段: 安全加固与生态扩展 (2026-02-10 ~ 2026-02-18)

**核心事件**: 从"能跑"走向"安全稳定跑"，大量安全机制和防护措施在这一阶段密集引入

这一阶段体现了一个典型的工程迭代模式：先让核心逻辑跑通，然后在真实环境中发现各种边界情况和安全隐患，逐一修补。v1.10.x 系列连续发布了 15 个小版本，每一个都在修复真实运行中发现的具体问题。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 02-10 | `2a59c45` | feat: add Forbidden Innovation Zones to GEP prompt (Section X) |
| 02-10 | `753f002` | feat: add Known Issues list to GEP prompt (Section VII.6) |
| 02-11 | `a9c7e53` | v1.10.3: configurable blast radius policy, structured status output |
| 02-11 | `56879ec` | feat: add MemoryGraphAdapter for open-source/SaaS boundary |
| 02-12 | `0a45243` | feat: session safeguards, anti-misattribution |
| 02-13 | `2f338b6` | v1.10.8: critical safety hardening -- prevent self-evolution accidents |
| 02-13 | `2f19f06` | v1.10.10: blast radius robustness hardening |
| 02-13 | `e164ff9` | v1.10.11: session scope isolation -- prevent cross-channel memory contamination |
| 02-13 | `49b12e8` | v1.10.12: canary via fork -- pre-solidify entry point verification |
| 02-13 | `2ba0505` | v1.10.13: failure streak awareness + circuit breaker |
| 02-14 | `035a6c7` | feat: add population-dependent drift and epigenetic marks |
| 02-15 | `2f49e6d` | v1.13.0: disable self-modification by default, add opt-in |
| 02-18 | `0d61637` | feat: add stable device fingerprint for node identity |
| 02-18 | `b2247d7` | feat: auto-claim and execute Hub tasks in evolution loop (v1.13.1) |

### 设计决策记录

**决策 1: 爆炸半径策略** -- 从 v1.10.3 开始引入可配置的爆炸半径。这个设计经历了 4 次迭代：
- v1.10.3: 初始实现 (`a9c7e53`)
- v1.10.10: 鲁棒性加固 (`2f19f06`)
- v1.10.12: canary via fork 验证 (`49b12e8`)
- 后续: policyCheck.js 抽取 (`ffba2c4`, 03-22)

**决策 2: 自我修改的默认策略** -- v1.13.0 做了一个重要决定：默认禁用 self-modification (`2f49e6d`)。这是一个内部争议的结果。开放自我修改能力让进化更灵活，但风险太高。最终选择 opt-in 模式，用环境变量 `EVOLVE_ALLOW_SELF_MODIFY` 控制。

**决策 3: 种群漂移设计** -- v1.12.3 引入 population-dependent drift 和 epigenetic marks (`035a6c7`)。这个设计借鉴生物学概念，让基因选择器的漂移强度取决于当前种群规模。这是一个非平凡的原创设计。

### 论据意义

1. **v1.10.x 的 15 个连续小版本** 是在真实运行环境中发现问题、修复问题的典型痕迹，不可能通过阅读别人代码产生。
2. **"禁止创新区域"** (Forbidden Innovation Zones) 是 Evolver 独创概念，后来 Hermes Agent 中也出现了类似的约束机制。
3. **表观遗传标记** (epigenetic marks) 是一个深度生物学类比，说明团队在认真思考进化理论的工程化，而不是简单的代码重写。
4. **默认禁用自我修改的决定** 体现了团队在安全性和灵活性之间的真实权衡过程。

---

## 第四阶段: 社区爆发与经验蒸馏 (2026-02-19 ~ 2026-02-28)

**核心事件**: 开源后社区涌入大量 PR，催生了 Skill Distiller、失败记忆、伦理约束等高级功能

Evolver 公开开源后，社区贡献开始密集涌入。团队需要处理外部 PR 的同时，继续推进核心功能。这一阶段引入了多个后来被 Hermes Agent "独立发明"的关键概念。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 02-21 | `f0aab15` | feat: agent proactive questioning via A2A fetch payload |
| 02-21 | `9afc8d2` | Add unit tests for core GEP modules |
| 02-22 | `064cbdd` | feat: add Skill Distiller module for cross-cycle experience distillation |
| 02-22 | `68ef354` | feat: failed mutation preservation -- anti-pattern memory system |
| 02-22 | `0eb9878` | feat: add heartbeat to keep agent nodes alive on hub |
| 02-22 | `47c18f3` | feat: merge community PRs #68 #26 #63 #21 #25 |
| 02-23 | `8860e80` | feat: enforce constitutional ethics in evolution prompt and solidify |
| 02-23 | `fe2d8f1` | feat: integrate LessonL lesson consumption into evolution cycle |
| 02-24 | `c2c586a` | feat: activate fork lineage by setting parent on Gene/Capsule publish |
| 02-26 | `675dbdf` | feat(signals): multilingual signal extraction + snippet-carrying tags |
| 02-27 | `9eccf76` | test: add 45 tests for strategy, validationReport, envFingerprint |
| 02-28 | `03a48c5` | refactor: replace PCEC with GEP and update cover image |
| 02-28 | `02a2518` | feat: smart task selection with ROI scoring and capability matching |

### 社区 PR 记录

这一阶段合并的社区 PR 证明 Evolver 是一个有真实用户和贡献者的活跃开源项目：

| PR | 日期 | 贡献内容 |
|----|------|----------|
| #4 | 02-13 | validation path resolution, asset file init, repair loop circuit breaker |
| #21 #25 #26 #63 #68 | 02-22 | 批量合并五个社区 PR |
| #107 | 02-26 | harden sanitize patterns for token leakage prevention |
| #112 | 02-26 | multilingual signal extraction + snippet-carrying tags |
| #139 | 02-27 | 45 tests for strategy, validationReport, envFingerprint |
| #144 | 02-27 | smart CPU load threshold + dotenv dependency fix |

### 设计决策记录

**决策 4: Skill Distiller 的诞生** -- `064cbdd` (02-22) 引入了跨周期经验蒸馏模块。这个模块的设计动机是：单次进化周期产生的改进可能是局部最优，需要一个机制将多次周期的经验"蒸馏"为可复用的技能。后来这个模块演化出了 1,234 行代码 (src/gep/skillDistiller.js)，成为 Evolver 最大的子模块之一。

**决策 5: 失败记忆系统** -- `68ef354` (02-22) 引入 anti-pattern memory。设计动机：早期 Evolver 会重复尝试已失败的变异策略。团队决定保存失败的变异记录，让后续周期避免重蹈覆辙。这个"负面记忆"概念后来成为三层记忆体系的重要组成部分。

**决策 6: 宪法伦理约束** -- `8860e80` (02-23) 在进化 prompt 和 solidify 阶段强制执行伦理约束。这意味着 Evolver 不会生成违反预设伦理原则的代码变更。这是一个在安全领域非常前瞻的设计。

**决策 7: PCEC 到 GEP 的术语迁移** -- `03a48c5` (02-28) 正式完成了从 PCEC 到 GEP 的术语替换。这个过程跨越了近一个月，中间有大量的中间状态 commit，说明这是一个渐进式的品牌演变，不是一次性重命名。

### 论据意义

1. **Skill Distiller 在 02-22 引入**，比 Hermes Agent 的 self-evolution 仓库创建 (03-09) 早 15 天。
2. **失败记忆系统** 是 Evolver 的原创设计，后来 Hermes Agent 中出现了几乎相同的概念 (负面经验存储)。
3. **社区 PR 记录** 证明 Evolver 是一个真实的、有用户参与的开源项目，不是事后伪造的时间线。
4. **45 个社区贡献的测试** (PR #139) 说明外部开发者深入理解了 GEP 协议的内部结构。

---

## 第五阶段: 反射引擎与 Hub 集成 (2026-03-01 ~ 2026-03-13)

**核心事件**: 引入反射周期 (Reflection)、叙事记忆 (Narrative Memory)、LLM Review、Skill Store 发布，以及 npm 发布

这一阶段标志着 Evolver 从"能自我进化"升级为"能反思、能共享、能学习他人经验"的完整系统。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 03-02 | `7f34510` | feat: git env pre-check and cross-language selector support |
| 03-03 | `9e4bce7` | **feat: add reflection phase, narrative memory, LLM review, and evolution principles** |
| 03-04 | `91f59b6` | feat(hubSearch): two-phase search-then-fetch to reduce credit cost |
| 03-04 | `143622d` | feat: auto-report recurring failures as GitHub issues |
| 03-05 | `4265dc4` | feat: add Worker Pool poll support via heartbeat |
| 03-05 | `5752f3f` | feat: auto-submit Hub asset reviews after solidify |
| 03-06 | `19544ab` | feat: add EVOLVER_ROLLBACK_MODE for safer rollback strategy (community PR #196) |
| 03-09 | `d309844` | feat: add commitment tracking support for task deadlines |
| 03-09 | `ba25148` | feat: add npm publishing as @evomap/evolver |
| 03-11 | `c931c91` | feat: add skill publisher -- auto-publish distilled Genes to Hub Skill Store |
| 03-11 | `388d82f` | feat: add ESL-1.0 license notice to generated SKILL.md footer |

### 设计决策记录

**决策 8: 反射周期的引入** -- `9e4bce7` (03-03) 是一个里程碑式的 commit，一次性引入了四个紧密耦合的子系统：
- **Reflection Phase**: 在每个进化周期后自动回顾本次变更的效果
- **Narrative Memory**: 将进化过程用自然语言叙述并持久化
- **LLM Review**: 用 LLM 对候选变更进行独立评审
- **Evolution Principles**: 可配置的进化原则约束

这四个子系统作为一个整体被引入，说明团队在引入前做了完整的架构设计。后来 Hermes Agent 中出现了几乎一一对应的概念。

**决策 9: 两阶段 Hub 搜索** -- `91f59b6` (03-04) 将 Hub 搜索从一步改为 search-then-fetch 两阶段，动机是减少 credit 消耗。这是一个典型的真实运行中发现成本问题后的优化决策。

**决策 10: npm 发布渠道** -- `ba25148` (03-09) 将 Evolver 发布到 npm 作为 `@evomap/evolver`。这个时间点比 Hermes Agent 的 self-evolution 仓库创建日 (03-09) 在同一天。

### 论据意义

1. **反射周期在 03-03 引入**，比 Hermes Agent self-evolution 仓库创建 (03-09) 早 6 天。但反射周期的设计复杂度远非 6 天能复刻，因为它涉及四个紧密耦合的子系统。
2. **叙事记忆** (Narrative Memory) 是三层记忆体系的第三层，完成了 Memory Graph (02-06) -> Anti-pattern Memory (02-22) -> Narrative Memory (03-03) 的渐进式构建。
3. **Skill Publisher** (03-11) 意味着 Evolver 节点可以将蒸馏出的技能发布到 Hub，形成跨节点的知识共享。这是 Hermes Agent "技能生态"概念的前身。

---

## 第六阶段: 大规模重构与质量提升 (2026-03-15 ~ 2026-03-23)

**核心事件**: 代码大规模重构 (solidify 拆分、var->const/let 迁移)、Auto Skills 引擎升级、群体进化

这一阶段是 Evolver 走向工程成熟的标志。代码质量、测试覆盖率和架构清晰度大幅提升。

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 03-15 | `f438c07` | feat: add Cursor agent-transcripts as fallback session source |
| 03-15 | `4d45c49` | feat: auto-distill every 5 solidifies + skill store heartbeat hints |
| 03-16 | `a206a8d` | feat: group evolution -- execution trace desensitization + diversity-directed drift |
| 03-17 | `d85b13c` | feat(learningSignals): add structured learning signal expansion module |
| 03-22 | `ffba2c4` | refactor: extract constraint/policy checking from solidify.js into policyCheck.js |
| 03-22 | `b066861` | refactor: extract git operations from solidify.js into gitOps.js |
| 03-22 | `945463e` | refactor: extract candidate evaluation from evolve.js into candidateEval.js |
| 03-22 | `c98bd1b` | test: add paths.test.js |
| 03-22 | `247a9d9` | test: add assetStore.test.js |
| 03-22 | `6d27672` | test: add solidify-helpers.test.js |
| 03-23 | `39104b9` | **feat: Auto Skills upgrade -- semantic search, reflection loop, validation retry, curriculum engine, distill publish** |
| 03-23 | `d665b4a` | feat(gep): add tool_bypass signal detection and gene_tool_integrity |
| 03-23 | `5e4d9b2` | fix: cap total personality mutations at 4 per cycle to prevent drift |

### 重构记录 (代码成熟度证据)

03-22 一天内进行了 28 个 commit 的大规模重构，这是 Evolver 历史上单日 commit 最多的一天：

1. **solidify.js 拆分**: 原始 solidify.js 是一个巨大的单体模块，被拆分为：
   - `policyCheck.js` (576 行) -- 约束和策略检查
   - `gitOps.js` -- Git 操作
   - `candidateEval.js` -- 候选评估
   - solidify.js 本身 (1,463 行) -- 核心固化逻辑

2. **var 到 const/let 迁移**: selector.js, solidify.js, evolve.js, a2aProtocol.js 全部迁移

3. **测试新增**: paths.test.js, assetStore.test.js, solidify-helpers.test.js

### 设计决策记录

**决策 11: 群体进化和多样性导向漂移** -- `a206a8d` (03-16) 引入了两个创新概念：
- **execution trace desensitization**: 脱敏执行轨迹用于跨节点共享
- **diversity-directed drift**: 当群体中基因多样性降低时，主动增加变异漂移

这些概念直接来自进化生物学的种群遗传学理论，不是从任何现有代码项目中能"洗"出来的。

**决策 12: 人格突变上限** -- `5e4d9b2` (03-23) 将每个周期的人格突变限制在 4 次。这个看似简单的数字背后是大量真实运行数据的分析：太多突变导致人格"漂移"失控，太少又导致适应性不足。

### 论据意义

1. **solidify.js 的拆分过程** 有完整的 commit 链 (b066861 -> ffba2c4 -> 945463e)，这种渐进式重构只可能发生在长期维护的代码库中。
2. **Auto Skills 升级** (03-23) 一次性引入 5 个子系统 (语义搜索、反射循环、验证重试、课程引擎、蒸馏发布)，说明团队在这之前有充分的设计准备。
3. **tool_bypass 信号检测** (03-23) 是一个防止 Agent 绕过工具调用约束的安全机制，这个概念在当时的其他项目中没有出现过。

---

## 第七阶段: 架构稳定与生态对接 (2026-03-27 ~ 2026-04-06)

**核心事件**: A2A 事件轮询、隐私计算、群体协作、多 Agent 平台兼容

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 03-27 | `3f2029a` | feat(a2a): handle has_pending_events and poll hub events in heartbeat |
| 04-04 | `127c7ce` | feat: merge community PR #333 - input sanitization and ReDoS protection |
| 04-04 | `155230c` | feat: add hub infrastructure client helpers to a2aProtocol |
| 04-06 | `748320f` | feat(v1.46.0): privacy computing client, agent directory, SSE stream, swarm PDRI signals |
| 04-07 | `5f209e2` | feat: local state awareness hook + EvoMap-first problem resolution |
| 04-07 | `1784cc6` | fix: task-based agent compatibility (Cursor/Codex/Manus) |
| 04-07 | `5643ab6` | fix: support Claude Code session log format in readCursorTranscripts |

### 论据意义

1. **隐私计算客户端** (04-06) 说明 Evolver 团队在思考去中心化 Agent 网络中的数据隐私问题，这远超简单的代码重写所能涉及的深度。
2. **多 Agent 平台兼容** (Cursor, Codex, Manus, Claude Code) 表明 Evolver 是为真实生态设计的，不是学术演示。

---

## 第八阶段: 许可证变更与代码保护 (2026-04-09 ~ 2026-04-15)

**核心事件**: 因 Hermes Agent 事件，许可证从 MIT 变更为 GPL-3.0，引入代码混淆、完整性校验、Self-PR 能力

### 关键 commit

| 日期 | Commit | 内容 |
|------|--------|------|
| 04-09 | `64cf65d` | **chore: switch license to GPL-3.0-or-later** |
| 04-09 | `57a5d3c` | feat: multi-strategy signal extraction (regex + keyword scoring + LLM) |
| 04-09 | `ecec083` | feat: swarm collaboration enhancement -- evolver-side support |
| 04-09 | `2dab4de` | feat: force update mechanism -- Hub-directed multi-channel self-update |
| 04-10 | `b0902e4` | fix(selector): replace preferredGeneId hard override with score multiplier |
| 04-10 | `bb43145` | feat: add Evomap Proxy module with JSONL mailbox |
| 04-11 | `c11cd93` | feat(gep): TTT-inspired evolution engine upgrades |
| 04-11 | `0619ff8` | feat(security): obfuscate core modules in public build + Hub solidify verification |
| 04-13 | `4d2047b` | feat(security): full code hardening -- obfuscation, integrity, offline permits, anti-debug |
| 04-13 | `570dcb8` | feat: auto-detect platform environment, remove OpenClaw/wrapper dependency |
| 04-14 | `5f8be5e` | feat: self-PR -- auto-contribute high-confidence mutations to public repo |
| 04-14 | `550e73a` | feat(atp): add ATP module -- merchant/consumer agent templates and hub client |

### 设计决策记录

**决策 13: GPL-3.0 许可证变更** -- `64cf65d` (04-09) 标志着一个艰难的决定。EvoMap 团队原本信奉 MIT 许可证的开放精神，但在核心架构被无归属复制后，被迫转向 GPL-3.0 以获得最低限度的法律保护。

**决策 14: TTT (Test-Time Training) 灵感** -- `c11cd93` (04-11) 将 TTT 概念引入进化引擎。这个学术概念的工程化实现需要深入理解 TTT 论文，不是简单的代码"洗"能产出的。

**决策 15: Self-PR 机制** -- `5f8be5e` (04-14) 让 Evolver 自身能够将高置信度的变异自动作为 PR 提交到公开仓库。这是 "evolver 本身就在 evolve" 的终极证明。

### 论据意义

1. **许可证变更的时间线** 精确对应了 Hermes Agent 事件的时间线，是直接的因果关系。
2. **Self-PR 机制** 意味着 Evolver 不仅在进化目标代码库，还在进化自身。这是数据飞轮的核心闭环。

---

## 功能模块演化地图

以下按模块追踪每个核心概念的完整演化链，证明这些不是一次性设计的，而是在持续迭代中逐步成型的。

### 模块 1: 进化主循环 (src/evolve.js -- 2,531 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-01 | v1.0.x | PCEC Cycle (Perceive-Cognize-Evolve-Commit) |
| 02-03 | v1.0.40 | 解耦为独立 evolver |
| 02-04 | v1.1.0 | 重构为 GEP 协议 |
| 02-07 | v1.5.1 | 加入守护进程循环 (daemon loop) |
| 02-10 | v1.10.0 | 加入已知问题列表和禁止创新区域 |
| 02-18 | v1.13.1 | 加入 Hub 任务自动认领 |
| 03-03 | v1.23.0 | 加入反射阶段 |
| 03-22 | v1.34.0 | 拆分 candidateEval.js |
| 04-11 | v1.52.0 | TTT 灵感升级 |

### 模块 2: 基因选择器 (src/gep/selector.js -- 556 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-04 | v1.1.0 | 基础选择器 |
| 02-14 | v1.12.3 | 种群依赖漂移 + 表观遗传标记 |
| 02-20 | -- | 导出 matchPatternToSignals |
| 03-02 | v1.21.0 | 跨语言 selector 支持 |
| 03-22 | v1.34.0 | var->const/let 现代化 |
| 04-10 | v1.50.0 | 替换硬覆盖为分数乘数 |
| 04-10 | v1.51.0 | 自适应漂移衰减、per-signal-key ban |

### 模块 3: 记忆体系 (三层)

**第一层: Memory Graph (src/gep/memoryGraph.js -- 1,073 行)**

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-06 | v1.2.0 | Memory Graph v1 因果进化 |
| 02-06 | v1.2.0 | Memory Graph v2 + A2A 交换 |
| 02-09 | v1.8.0 | memoryGraphStatePath 修复 |
| 02-11 | v1.10.1 | MemoryGraphAdapter 开源/SaaS 边界 |
| 04-10 | v1.50.0 | 正向证据要求 (require positive evidence) |
| 04-10 | v1.50.0 | 扩展错误信号检测 |

**第二层: Anti-pattern Memory (失败记忆)**

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-13 | v1.10.13 | failure streak awareness + circuit breaker |
| 02-22 | v1.18.0 | failed mutation preservation 引入 |

**第三层: Narrative Memory (叙事记忆)**

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 03-03 | v1.23.0 | narrative memory 引入 |
| 03-15 | v1.30.0 | Cursor transcripts 作为信号源 |

### 模块 4: Solidify 固化引擎 (src/gep/solidify.js -- 1,463 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-04 | v1.1.0 | 初始 solidify |
| 02-06 | v1.4.4 | 验证命令安全检查 |
| 02-11 | v1.10.3 | 爆炸半径策略 |
| 02-13 | v1.10.12 | canary via fork 验证 |
| 02-23 | v1.19.0 | 宪法伦理约束 |
| 03-16 | v1.30.2 | 移除破坏性 git rollback |
| 03-22 | v1.35.0 | 拆分为 policyCheck.js + gitOps.js |
| 04-11 | v1.53.0 | 阻止只修改 GEP 元数据的空洞 commit |

### 模块 5: 信号提取 (src/gep/signals.js -- 660 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-01 | v1.0.x | 基础日志扫描 |
| 02-07 | v1.6.0 | 创新信号检测 |
| 02-09 | v1.9.1 | 信号去重 |
| 02-26 | v1.20.0 | 多语言信号提取 (from PR #112) |
| 03-17 | v1.32.0 | 结构化学习信号扩展 |
| 04-09 | v1.48.0 | 多策略信号提取 (regex + keyword scoring + LLM) |

### 模块 6: A2A 协议 (src/gep/a2aProtocol.js -- 1,423 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-06 | v1.2.0 | A2A 交换初始实现 |
| 02-07 | v1.5.0 | A2A 协议正式化 |
| 02-22 | v1.16.0 | Heartbeat 保活 |
| 03-05 | v1.27.0 | Worker Pool poll |
| 03-09 | v1.28.0 | commitment tracking |
| 03-22 | v1.34.0 | 错误日志增强 |
| 03-27 | v1.40.0 | 事件轮询 (has_pending_events) |
| 04-04 | v1.41.0 | Hub 基础设施客户端 |

### 模块 7: Skill Distiller (src/gep/skillDistiller.js -- 1,234 行)

| 时间 | 版本 | 演化事件 |
|------|------|----------|
| 02-22 | v1.18.0 | 初始 Skill Distiller |
| 03-01 | v1.20.4 | 移除 Gemini 依赖 |
| 03-11 | v1.29.0 | Skill Publisher 到 Hub |
| 03-13 | v1.29.8 | 命名规则强制、质量门控 |
| 03-15 | v1.30.1 | auto-distill 每 5 次 solidify |
| 03-23 | v1.39.0 | 课程引擎、蒸馏发布全面升级 |

---

## 数据飞轮: Evolver 进化自身的证据

截图中对方提到 "如果 evolver 本身就在 evolve，一些功能和设计是在数据飞轮中迭代的"，这恰恰是 git 历史能完美证明的。

### 证据 1: 进化引擎自我修复

| 日期 | Commit | 事件 |
|------|--------|------|
| 02-01 | `7e6ca66` | Evolution: Self-Awareness Upgrade (Log Reading) -- Evolver 学会读自己的日志 |
| 02-01 | `7380485` | Evolution: Adaptive Stability Logic in capability-evolver -- Evolver 给自己加了稳定性逻辑 |
| 02-01 | `af29215` | Evolution: Optimized evolve.js caching & context -- Evolver 优化了自己的缓存 |
| 02-03 | `2a441f0` | Evolution: Fixed evolver recursion paths -- Evolver 修复了自己的递归路径 |

这些 commit 证明 Evolver v1.0 阶段的进化引擎已经在对自身进行优化。

### 证据 2: Self-PR -- 终极闭环

`5f8be5e` (04-14) 引入 Self-PR 机制：Evolver 运行进化周期后，如果产生的变异达到高置信度阈值，会自动创建 PR 提交到公开仓库。这实现了：

```
用户使用 Evolver -> 产生进化数据 -> 进化引擎分析数据
-> 产生改进变异 -> 高置信度变异自动提交 PR -> 团队 review
-> 合并到主仓库 -> 新版本发布 -> 用户使用新版 Evolver
```

这就是数据飞轮。Evolver 的每一个用户都在帮助 Evolver 进化自己。

---

## 关键时间线对比 (Evolver vs Hermes Agent)

| 事件 | Evolver | Hermes Agent | 时间差 |
|------|---------|--------------|--------|
| 初始 commit | 2026-01-31 | 2025-07-22 (私有) | Hermes 主仓库更早但为私有 |
| 自进化概念公开 | 2026-02-01 (公开) | 2026-02-25 (公开) | Evolver 早 24 天 |
| GEP/基因系统 | 2026-02-04 | -- | |
| Memory Graph | 2026-02-06 | -- | |
| 变异协议 | 2026-02-06 | -- | |
| 创新信号检测 | 2026-02-07 | -- | |
| 安全加固 (爆炸半径) | 2026-02-11 | -- | |
| Skill Distiller | 2026-02-22 | -- | |
| 失败记忆 | 2026-02-22 | -- | |
| 宪法伦理约束 | 2026-02-23 | -- | |
| 反射周期 | 2026-03-03 | -- | |
| 叙事记忆 | 2026-03-03 | -- | |
| npm 发布 | 2026-03-09 | -- | |
| Hermes self-evolution 仓库创建 | -- | 2026-03-09 | Evolver 所有核心概念均已公开 |
| Skill Publisher | 2026-03-11 | -- | |
| 群体进化 | 2026-03-16 | -- | |
| Hermes 技能生态发布 | -- | 2026-03-12 | |
| GPL-3.0 许可证变更 | 2026-04-09 | -- | 因 Hermes 事件 |

---

## 不可复制的迭代特征

以下特征证明 Evolver 的架构是在持续迭代中自然生长出来的，不是一次性设计的：

### 1. 术语演变轨迹

```
PCEC (01-31) -> capability-evolver (02-02) -> evolver (02-03) -> GEP (02-04) -> 正式 GEP (02-28)
```

这条术语链有 5 个中间状态，每一步都有 commit 记录。一次性设计不会留下这种演变痕迹。

### 2. Bug 修复密度

888 个 commit 中有 128 个包含 fix 前缀 (约 14%)。这种 bug 修复比例说明团队在真实运行环境中持续发现并修复问题。一个从零设计的项目不会在原型阶段就有这么多 fix commit。

### 3. 社区贡献的 PR 编号连续性

合并的社区 PR 编号: #4, #21, #25, #26, #63, #68, #107, #112, #139, #144, #164, #167, #196, #217, #218, #226, #232, #260, #333, #361, #364, #372。

编号从 #4 到 #372，说明公开仓库有至少 372 个 issue/PR 的交互记录。这种社区活跃度不可能伪造。

### 4. 设计决策的回退记录

- `4b28a96` (03-16): 移除破坏性 git rollback -- 这是发现前一个决策有问题后的回退
- `c398c36` (03-30): 防止 early-stabilize 覆盖 FORCE_INNOVATION -- 两个功能冲突的修复
- `b0902e4` (04-10): 替换 preferredGeneId 硬覆盖为分数乘数 -- 发现硬覆盖导致病理行为

这些回退记录说明团队在实践中不断调整设计，而不是一次性照搬。

### 5. 跨模块依赖的渐进式建立

三层记忆体系不是一次设计的，而是在三个不同时间点各自独立引入，后来整合的：
- Memory Graph: 02-06
- Anti-pattern Memory: 02-22 (16 天后)
- Narrative Memory: 03-03 (又 9 天后)

这种时间间隔反映了真实的认知过程：先发现需要因果记忆，再发现需要失败记忆，最后发现需要叙事记忆。

---

## 附录: 核心源码文件清单

### src/gep/ (GEP 引擎, 15,824 行)

| 文件 | 行数 | 功能 | 首次 commit 日期 |
|------|------|------|-----------------|
| solidify.js | 1,463 | 变更固化引擎 | 02-04 |
| a2aProtocol.js | 1,423 | Agent-to-Agent 协议 | 02-06 |
| skillDistiller.js | 1,234 | 跨周期经验蒸馏 | 02-22 |
| memoryGraph.js | 1,073 | 因果记忆图 | 02-06 |
| signals.js | 660 | 信号提取 | 02-01 |
| prompt.js | 646 | 进化提示工程 | 02-04 |
| policyCheck.js | 576 | 约束/策略检查 | 03-22 (从 solidify 拆出) |
| selector.js | 556 | 基因选择器 | 02-04 |
| taskReceiver.js | 566 | Hub 任务接收 | 02-18 |
| hubSearch.js | 480 | Hub 搜索客户端 | 02-28 |
| personality.js | 423 | 人格进化 | 02-06 |
| selfPR.js | 400 | 自动 PR 提交 | 04-14 |
| questionGenerator.js | 393 | 主动提问 | 02-21 |
| assetStore.js | 369 | 资产存储 | 02-04 |
| reflection.js | 177 | 反射引擎 | 03-03 |
| narrativeMemory.js | 108 | 叙事记忆 | 03-03 |
| curriculum.js | 163 | 课程引擎 | 03-23 |
| candidateEval.js | 92 | 候选评估 | 03-22 |
| learningSignals.js | 89 | 学习信号扩展 | 03-17 |
| mutation.js | 201 | 变异策略 | 02-06 |
| strategy.js | 136 | 进化策略 | 02-04 |

### src/evolve.js (进化主循环, 2,531 行)

包含完整的 10 步进化循环编排逻辑。

---

*文档生成时间: 2026-04-16*
*数据来源: evolver-private-dev 仓库 git 历史*
*总计覆盖: 888 commits (含所有分支), 117 releases, 75 天开发周期*
