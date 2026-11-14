# dsh-token-saver 审计报告

- 审计对象：`dsh-token-saver` v1.0.4（HEAD `5a335ea`，工作区干净）
- 仓库：`/home/lovedolove/projects/dsh-token-saver`
- 测试基线：`npx vitest run` → 17 files / 178 tests **全绿**（修复后；审计当时为 170）
- 方法：读源码 + 针对 `src/` 直接调用内部函数复现（不走打包产物），每个结论都有可复跑的探针

> 说明：下列结论中，标 ✅ 的是我本人独立复现过的；标 ⚠️ 的是原审计（子代理）提出、但被我复现**推翻或降级**的。

---

## 0. 一句话结论

插件方向是对的，但当前 HEAD 有一个**会静默销毁用户数据**的致命缺陷（B1），并且**发布产物 `lib/` 是旧的**（F1）——也就是说线上装到的版本既没有新功能，又带着旧 bug。这两件事优先级远高于其它所有条目。

---

## 1. 数据销毁类（优先修，按严重度排序）

### B1 ✅ 任意 Markdown / 含 `## ` 的文本会被当作 `git status` 压成两行

**根因**：`src/rtk/autodetect.ts:77`

```ts
// 3. git status (standard prose/header)
if (/^## /m.test(window) || /^On branch /m.test(window)) {
  return gitStatus
}
```

`window` 是文本开头 `DETECT_WINDOW = 1024`（`src/rtk/constants.ts:8`）个字符。任何在开头 1KB 内出现 `## ` 的 Markdown（README、CHANGELOG、任何文档）都会被判定为 git status。

**复现**（`/tmp/tsa/probe59.mjs`，785 字节的 README，`rtkEnabled: true`）：

```
input bytes: 785 (MIN_COMPRESS_SIZE=500)
folded: true | bytes: 785 -> 39
MODEL RECEIVES: "branch: Contributing\nClean working tree"
data destroyed: % 95
```

模型拿到的就是这个 39 字节字符串——整篇 README 没了，而且插件把它记为「省了 746 字节」。

**为什么现在没被发现**：本该拦住它的守卫**是死代码**。`src/strategies/tool-result-trim.ts:48-57` 定义了

```ts
const READ_LIKE_TOOLS = new Set(['read','cat','file_read','get_file','view','fetch','http_get','curl'])
```

全仓库唯一引用是 `:308` 的 `__testing` 导出。`read` 类工具的输出不该走 git-status 自动探测——而这正是 `READ_LIKE_TOOLS` 存在的原因。

**修法（根因，最小 diff）**：在 `decidePostTool` 的 RTK 分支里，当 `toolName ∈ READ_LIKE_TOOLS` 时跳过 `autoDetectFilter` 的隐式探测（只保留显式 `TOOL_RTK_FILTERS`）。这一个守卫同时修好 B1 并让 L2 的死代码复活。

**同时需要**：`decidePostTool` 返回值只有 `{decision, folded, originalBytes, trimmedBytes}`，**没有** `strategy` / `rtkFilter` 字段（`src/types.ts` 里 `FoldResult` 有，但没传到 hook 边界）。调用方无法区分「正常截断」和「git-status 误判」。建议透出 `rtkFilter`，让 UI/日志能暴露这类误判。

### B2 ✅ `isMostlyPorcelain` 阈值过松，普通散文被改写

`src/rtk/autodetect.ts:21` 的判定只要「采样 ≥3 行且 ≥50% 命中」。400 行 / 8899 字节的普通散文 → 1284 字节，`filterUsed='git-status'`，约 86% 内容被销毁。这比 B1 更隐蔽，因为它不需要 `## ` 触发，只要行内容长得像 status 行。

### B3 ✅ `git status` 的 ignored（`!!`）条目被同时算进 staged 和 modified

**根因**：`src/rtk/filters/gitStatus.ts:40-41`

```ts
if (x !== ' ' && x !== '?') staged.push(`${x} ${file}`)
if (y !== ' ' && y !== '?') modified.push(`${y} ${file}`)
```

`!` 既不是空格也不是 `?`，于是忽略项同时混入两个列表。**复现**（`/tmp/tsa/probe64.mjs`）：

```
branch: main

staged (2):
  ! node_modules/
  ! dist/

modified (62):
  ! node_modules/
  ! dist/
  src/deep/path/module0.ts
  ...
```

成因：对 `!! path` 这一行，状态列是 `x='!'`、`y='!'`，两者都不等于空格或 `?`，于是 `:40` 把它推进 `staged`、`:41` 又推一次进 `modified`（末尾的 `:42` 只捕获 `??`，收不到 `!!`）。

修法：在 `:40-41` 之前显式排除忽略项（`x === '!' && y === '!'` 时跳过，或单独归入 ignored 列表）。

### B8 ✅ 开启 localResponses 后，**每个会话的标题都是「Conversation」**

`src/local-responses/detectors.ts:160-170`：

```ts
export function titleAnswer(request: RequestLike | undefined): LocalAnswer | null {
  if (hasTools(request)) return null
  if (request?.purpose === 'session-title') {
    return { kind: 'title', text: 'Conversation', usage: makeUsage(100, 5), model: request?.model }
  }
  ...
```

`purpose: 'session-title'` 是 DSH **真实存在**的用途（`dsh-session-title-llm/lib/index.js:196` 构造它），而且该请求**不带 tools**——所以 `hasTools(request)` 为 `false`，这个分支必然会命中。**探针 `/tmp/tsa/probe71.mjs`**：

```
session-title, no tools -> {"kind":"title","text":"Conversation", ...}
```

返回值就是标题本身。于是所有会话标题被硬编码成 `'Conversation'`。`title` 在 `OPTIMIZATIONS`（`detectors.ts:15-18`）里默认启用，所以任何开了 `localResponsesEnabled` 的用户都会中招。

**修法**：删掉这个 `purpose` 分支让真实标题请求走上游，或从 `singleUserTurn(request)` 的首条用户消息里构造标题。

---

## 2. 发布/工程类

### F1 ✅ `lib/` 是陈旧构建产物，且被提交进仓库

- `package.json:46` → `"main": "./lib/index.js"`，`:39-40` → `"files": ["lib", ...]`。**线上跑的是 `lib/`，不是 `src/`。**
- 最后一次改动 `lib/` 的提交是 `3182b62`（2026-10-21）；HEAD `5a335ea`（2026-10-27）新增了 `src/rtk/filters/table.ts` 和 `compactPressureThreshold` 两段式闸门。
- `lib/rtk/filters/` **没有** `table.js`：

```
src/rtk/filters/: buildOutput dedupLog find gitDiff gitLog gitStatus grep ls readNumbered searchList smartTruncate table tree   (13)
lib/rtk/filters/: buildOutput dedupLog find gitDiff gitLog gitStatus grep ls readNumbered searchList smartTruncate      tree   (12, 无 table)
```

- `lib/index.js` mtime = 2026-10-21 22:43，`src/index.ts` mtime = 2026-10-21 18:16。

**影响**：所有通过 npm/市场安装的用户**拿不到 table 过滤器，也没有两段式闸门**——HEAD 的卖点功能对真实安装是惰性的。而 `lib/` 被 git 跟踪（90 个文件），意味着每次改源码都要记得手工重建并提交，否则线上/仓库永久分叉。

**修法**：`lib/` 从版本控制移除并加进 `.gitignore`，构建改由生命周期脚本驱动。

**实际修复（含两个修复本身引入/暴露的连带缺陷）**：

1. `lib/` 移出版本控制（90 个文件 `D`），`.gitignore` 加入构建产物规则。
2. **连带缺陷①：`.gitignore` 里写的是裸 `lib/`，它是无锚定模式，会连带匹配 `src/lib/`。** 而 `src/lib/` 存的是真实源码（`fold-grep.ts`、`index.ts`、`truncate.ts`）。已有的 3 个文件因已被跟踪而不受影响，但**此后任何新增到 `src/lib/` 的文件都会被静默忽略**——这正是这类"清理提交产物"改动最典型的二次伤害。已改为锚定的 `/lib/`：

   ```
   # Build output only. Must stay anchored: a bare `lib/` also matches `src/lib/`,
   # which holds real sources and would silently swallow any new file added there.
   /lib/
   ```

   验证：`git check-ignore` 下 `lib/index.js` → IGNORED，`src/lib/NEWFILE.ts` → not ignored。

3. **连带缺陷②：`package.json` 只有 `prepack`，没有 `prepare`。** README 文档的安装渠道是 **git tag URL**（`dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.4`）。经实测确认：**npm 对 git 依赖只运行 `prepare`，不运行 `prepack`、也不运行 `build`**（用生命周期标记脚本验证，输出为 `ran: prepare` 两次；仅 `build` / 仅 `prepack` / 无脚本三种对照组全部 `lib built? NO`）。也就是说，第 1 步删除 `lib/` 若不同时补 `prepare`，**所有按 README 安装的用户会拿到入口文件不存在的坏包**。已补：

   ```json
   "prepare": "npm run build",
   ```

   验证（真实仓库、真实 git URL 安装、源码树中零个 `lib/` 文件）：安装后 `lib/index.js` 与 `lib/rtk/filters/table.js` 均于安装时刻生成，过滤器 13 个齐备。

   附带确认：`prepare` 执行时 devDependencies 已安装可用（npm 内部以 `--include=dev` 运行），因此其中调用 `tsc` 是安全的；`prepack` 保留，负责 registry/tarball 渠道。

### F4 ✅ `promptCalls` 永远是 0，注入统计到不了 UI

- `src/settings.ts:107`：`const promptCalls = 0`——硬编码。
- `src/settings.ts:67-73` 的 `TotalSavings` 接口里**根本没有** `promptCalls` 字段。
- 但 `src/token-saver/pipeline.ts:61` 确实在累加它（`base.promptCalls + (report?.prompt?.injected === true ? 1 : 0)`），`test/token-saver.test.ts:109` 也断言过它是 `1`。
- `test/stats-store.test.ts:124` 反过来把 `0` 固化成期望值。

**影响**：管道里辛苦统计的「注入了几次系统提示」在 UI 上恒为 0，且这个错误被测试锁死。修法：把 `promptCalls` 加进 `TotalSavings`，从持久化 totals 里读，并改掉那条测试。

### F2 ✅ 级联压缩：同一段内容被压两遍，第二遍在残骸上再砍 99%

`tools/post-execute`（transform hook）和 `llm/stream`（`compressMessages`）都会跑 RTK。**探针 `/tmp/tsa/probe60.mjs`**（900 个文件的 diff）：

```
pass1 post-tool : 111839 -> 55467      (head/tail 截断)
pass2 llm/stream: saved 54985 | hits 1  (再次压缩)
模型最终看到     : 482 字节
```

**这本身是「按设计」的**——`src/stats-store.ts:10-13` 明确写着：

> Because the same tool output can be compacted twice — once by tools/post-execute and again by llm/stream on the already-compacted text — `calls` counts compaction events …

所以 `saved` 的算术是**精确**的（55467−54985 = 482，与记录的总削减一致），**不是**原审计所说的「重复计数」。⚠️ 我据此**推翻**了「double-count」的定性。

**真正的问题是级联本身**：第一遍已把 111839 砍到 55467，第二遍又在这个残骸上再砍掉 99%（55467 → 482），两次都没有上限、没有互斥。模型最终只拿到 482 字节。修复方向：第二遍应识别并跳过已被 RTK 处理过的文本（例如打标记），而非继续叠加。

> **后续变更（v1.0.6）**：为符合 DSH 官方插件规范，`llm/stream` 不再改写请求（agent 循环的请求是冻结的），级联的第二遍已移除；工具输出只在 `tools/post-execute` 压缩一次。本节的实测数据保留为当时的审计记录。

### F3 ✅ UI 标签「生效请求 / Calls Handled」与语义不符

`client.js:36/86/570` 显示的 `calls` 来自 `src/settings.ts:106`：

```ts
const calls = totals ? Math.max(0, totals.calls) : (rtkStats?.hits?.length ?? 0)
```

统计的是 `compressText` 的**命中次数**（一段文本被压了几次），不是「请求数」。一次工具调用里压了 3 个块会显示 3。标签应改为「压缩次数 / Compressions」或按 invocation 去重。

---

## 3. 性能 / 健壮性

### R1 ✅ `fold-grep` 每条线重新构造 RegExp，且可被 ReDoS

**根因**：`src/lib/fold-grep.ts:124-134` 的 `containsPattern` 每次调用都 `new RegExp(body)`，而它在 `:54/:59` 的逐行循环里被调用。

- 5 万行、`/needle/`：11 ms（`/tmp/tsa/probe69.mjs`）
- 5 万行、裸 `needle`：4 ms
- **灾难性回溯**（pattern 由模型提供）：`/(a+)+$/`

```
ReDoS n=18: 22 ms
ReDoS n=20: 33 ms
ReDoS n=22: 128 ms
```

指数增长——n=30 时探针直接挂死 60s 被我 kill。pattern 来自模型，等于把「模型写一个坏正则」变成「插件线程卡死」。

**修法**：`new RegExp` 提到循环外编译一次；对包裹形式加超时/长度上限，或换线性匹配。

### ⚠️ R1 附带结论被推翻：裸 pattern 是**字面量**，不是正则

原审计称「裸 `ne.dle` 会按正则匹配到 `neXd le`」。**复现结果相反**（`/tmp/tsa/probe67.mjs`，用 `matchCount` 判别）：

```
bare 'ne.dle' vs 'needle here'   -> matchCount: 0   (0=字面量)
bare 'ne.dle' vs 'ne.dle here'   -> matchCount: 1   (1=字面量命中)
wrap '/ne.dle/' vs 'needle here' -> matchCount: 1   (1=正则命中)
```

结论：只有 `/…/` 包裹形式才走正则，裸串走 `String.includes`。**语义是自洽的，不是 bug**——之前那次「确认」是对着 `folded`/字节数判读造成的误判。

### B4 ✅ 已修复：`rebuildContent` 混用字节数与字符串下标，多字节内容被**成倍重复**

原判定为「潜在」（latent）。**现已确认为真实缺陷并修复。**

`src/strategies/tool-result-trim.ts`（修复前 `:283-303`）：`newText.slice(0, Math.min(newTextBytes, originalBytes / 3))`——`String.slice` 吃的是 UTF-16 码元下标，而 `newTextBytes` / `originalBytes` 是 `Buffer.byteLength` 的**字节数**。对 CJK（每码元 3 字节）这是 3 倍超调：head 那一刀根本没切开，tail 的 `newText.slice(-Math.max(0, originalBytes - pos))` 又从头取回几乎整串——两段**互相重叠**。

**复现**（`/tmp/tsa/probeB4b.mts`，2 个 CJK 块 × 900 字节，`newText` 1500 字节）：

```
originalBytes      = 1802 (head 预算 /3 = 600 bytes)
newTextBytes       = 1500
head block bytes   = 1500   <-- OVER BUDGET
tail block bytes   = 1500
output total bytes = 3000 vs newTextBytes 1500
duplicated content : true
```

即**压缩把 1500 字节变成了 3000 字节**——这段代码不但没省 context，反而翻倍消耗，还让同一段内容在模型看来出现两次。触发条件（工具返回多个 text block + 非 ASCII）正是 `read` 一个中文文件/日志的常见形态。

**为什么之前标成 latent**：第一次探针只构造了「单块」和「多块但 ASCII」两种情形，单块走 `:276-280` 快速路径直接返回，多块 ASCII 时字节数恰好等于码元数（1:1）所以蒙混过关。CJK 才暴露 3:1 的错位。

**修法（根因）**：废弃 head/tail 二分启发式，改为**按各块在原始聚合文本中的字节份额**分配：

```ts
splitTextByByteShares(text, shares)   // 末块吸收取整余数
floorCharBoundary(buf, offset)        // 回退到 UTF-8 字符边界
```

不变式：**各块拼回来必须逐字节等于 `newText`，且不得产生 `\uFFFD`**。

**端到端对照**（`/tmp/tsa/probeB4e2e.mts`，走真实入口 `decidePostTool`，2 个含换行的 CJK 文本块，`read` 工具，36978 字节）：

```
                    修复前(HEAD)      修复后(工作区)
decision.kind       accept            accept
折叠                true              true
实际输出字节        41070  ← 涨了     24689
上报 trimmedBytes   24689             24689
reported == actual  否，差了 16381    是
```

注意修复前不止是「没省下来」：它向 `stats-store` 上报 `trimmedBytes: 24689`、`savedBytes ≈ 12290`，**而实际吐出去 41070 字节**。也就是说统计面板上的「节省」是假的，真实的 context 反而被吃掉更多。这类「上报值 ≠ 实际值」的偏差比单纯不省更危险，因为它会污染后续所有基于 `savedBytes` 的判断。

附带一个触发条件：`truncate` 在 `preserveStructure` 下不会在行中间下刀，所以**不带换行的纯 CJK 长串根本走不到 `rebuildContent`**（实测 `folded: false`）。必须带换行（真实的中文文件/日志正是如此）才会进入多块重建路径，B4 也才暴露。

**验证**：
- 回归测试 4 条（`test/tool-result-trim.test.ts:373-431`）：多字节不重复、不产生半个字符、无 segment 权重时负载只出现一次、拼接恒等。
- 随机 fuzz 4000 例（`/tmp/tsa/probeB4fuzz.mts`，混合 ASCII/CJK/emoji/换行、2-4 块、块内随机含非 text 块）：**0 条真实违规**。另有 28 例属「全部块都是非 text 块」的退化输入（压缩后的文本无处安放），已单独归类，不计为缺陷。
- 附带修正：`originalText` 参数修完后彻底无用，已连同调用点一并删除（`rebuildContent` 现为 3 参）。

### ⚠️ B5（U+FFFD）被推翻

原审计称多字节切分会产出替换字符。**复现**（`/tmp/tsa/probe70.mjs`，CJK 文本，`headBytes: 51`）：无论 `preserveStructure` true/false，**都没有** `\uFFFD`。`src/lib/truncate.ts` 的 `breakAtLineBoundary` / `sliceByBytes` 处理是正确的。

### ⚠️ B6 / B7 被降级

- **B6**：`tree` 过滤器在超 `TREE_MAX_LINES = 1000` 时**会**在最后一行输出 `"... (N tree lines omitted)"`，不是静默丢弃尾部。
- **B7**：截断标记**确实**填了字节数。`src/lib/truncate.ts:22` 的字面模板 `N bytes omitted` 在 `:66` 被 `.replace()` 换掉。**探针 `/tmp/tsa/probe62.mjs`**：标记显示 `6.6KB omitted`，`omittedBytes` 字段 `6800`，实测 `6796`（差值来自行边界对齐）。只有**调用方自己传 separator** 时才会保留字面 `N`。


---

## 4. 死代码 / 小问题

| 项 | 位置 | 说明 |
|---|---|---|
| L1 ✅ | `src/rtk/registry.ts:27` | `ls` 过滤器已注册，但 `autoDetectFilter` 永不返回它。探针 `probe63`：`total 12\n-rw-r--r-- …` → `filter: null`。**生产不可达** |
| L2 ✅ | `src/strategies/tool-result-trim.ts:48-57` | `READ_LIKE_TOOLS` 是死代码——但它正是修 B1 需要的那把钥匙。修好 B1 就顺手消灭了这条 |
| L4 | `src/rtk/constants.ts:10-44` | 大量常量（`GIT_DIFF_HUNK_MAX_LINES`、`STATUS_MAX_FILES`、`TREE_MAX_LINES` 等）只在 `__testing` 或默认参数里出现 |
| L5 | 同上 | 所有可选 filter 参数在生产路径上不可达 |
| F14 ✅ | — | 仓库**没有 CI**。F1（陈旧 `lib/`）和这一条是同一个根因的两面。已新增 `.github/workflows/ci.yml`：pnpm install → lint → typecheck → test → build → `node scripts/verify-package.mjs`（校验所有 `exports` 入口都指向构建产物、46 个源模块都有编译输出、13 个过滤器都已注册） |

**已排查、确认无问题**：F11 无 XSS 面 ✅；F12 插件缺失路径有处理 ✅；F13 空统计文件渲染正常 ✅。

---

## 5. 建议的修复顺序

1. **B1** — `READ_LIKE_TOOLS` 守卫 + 透出 `rtkFilter`（数据销毁，最高优先）
2. **F1** — 删 `lib/` 出版本控制 + `.gitignore` 锚定 `/lib/` + 补 `prepare` 脚本 + CI 校验（否则第 1 条修了也发不出去）。**注意**：该项的两个连带缺陷见 §3 F1 的「实际修复」——裸 `lib/` 会误伤 `src/lib/`，而 `prepack` 不覆盖 git URL 安装，必须补 `prepare`
3. **B2 / B3** — 收紧 `isMostlyPorcelain`；`gitStatus.ts:40-41` 排除 `!!`
4. **F2** — 第二遍应识别并跳过已 RTK 处理过的文本（`calls` 语义已确认无误，不必改）
5. **R1** — RegExp 提到循环外 + 对模型提供的 pattern 限流
6. **F4 / F3** — 修 `promptCalls`（含改测试）、修正 UI 标签语义
7. **B8** — 删掉 `session-title` 分支或改为从首条用户消息构造标题
8. **L1 + L2** — 随第 1 条一并清理
9. ~~**B4** — 加多块 + CJK 回归测试后再动~~ ✅ 已完成：回归测试 4 条 + fuzz 4000 例，并顺带删掉失效的 `originalText` 参数
10. **F14** — CI ✅ 已完成（`.github/workflows/ci.yml`）

---

## 6. 值得肯定

- 错误处理契约严格：`decidePostTool` 顶层 `try/catch` 兜底 `accept`，`isError` 结果**永不**压缩（`tool-result-trim.ts:102-110`）——这个设计是对的，也正因为有了它，B1 才没有演变成更糟的事故。
- `truncate` 的字节边界处理（`breakAtLineBoundary` / `sliceByBytes`）经实测**正确**，多字节安全。
- 缓存稳定性（`stabilizeForCache`、`cache_control` 断点保持最后）设计合理。
- 170 个测试全绿、覆盖率结构清晰——问题不在测试纪律，而在**测试没覆盖「read 工具 + Markdown」这条路径**（`grep -rl "README" test/` 为空）。

---

### 复跑方式

所有探针在 `/tmp/tsa/probe59.mjs` … `probe70.mjs`，用仓库自己的 `src/` 直接跑：

```bash
cd /tmp/tsa && npx tsx probe59.mjs   # B1：README → 39 字节
cd /tmp/tsa && npx tsx probe64.mjs   # B3：!! 混入 staged/modified
cd /tmp/tsa && npx tsx probe71.mjs   # B8：title 被替换成 "Conversation"
cd /tmp/tsa && npx tsx probe67.mjs   # R1 附带：裸 pattern 是字面量（推翻）
cd /tmp/tsa && npx tsx probe69.mjs   # R1：ReDoS 指数增长
cd /tmp/tsa && npx tsx probe60.mjs   # F2：级联压缩
cd /tmp/tsa && npx tsx probe70.mjs   # B5：无 U+FFFD（推翻）
```
