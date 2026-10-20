# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**裁剪过大的工具输出，把更多上下文窗口留给模型。**

面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的可配置 Token 优化插件。它在文件读取、grep 结果和命令日志进入对话之前压缩这些内容，并提供可选的上下文压力处理、提示词处理、本地响应和 LLM 摘要压缩。

[English](README.md) · [版本发布](https://github.com/LoveDoLove/dsh-token-saver/releases) · [问题反馈](https://github.com/LoveDoLove/dsh-token-saver/issues)

## 为什么需要它

工具输出是填满上下文窗口最快的方式。一次文件读取或一次 `grep` 输出就可能为会话增加数万字节，而其中大部分内容模型根本用不到 —— 并且这些 token 会在之后的每一轮中持续占用。

DSH Token Saver 在 DSH 的工具执行边界拦截这些输出：对过长结果保留开头和结尾，把 grep 输出折叠为仅保留匹配项，并通过 RTK 压缩结构化命令输出。所有行为均可配置，额外功能（提示词处理、RTK、本地响应、LLM 摘要）默认关闭。

**快速安装。** 运行 `dsh plugin --profile web add github:LoveDoLove/dsh-token-saver`。指定版本安装与构建脚本授权见 [安装](#安装)。

## 功能

| 功能 | 说明 | 默认状态 |
|---|---|---|
| 工具输出裁剪 | 对过长的工具结果保留开头和结尾 | 除 `off` 外的所有模式均启用 |
| Grep 结果折叠 | 折叠大型 grep 输出并保留有用上下文 | 除 `off` 外的所有模式均启用 |
| 上下文压力处理 | 监测上下文压力，并可在更高模式下触发压缩 | `conservative` 下关闭，`balanced`/`aggressive` 下启用 |
| RTK 集成 | 通过 RTK 压缩受支持命令的输出 | 关闭 |
| Caveman 提示词处理 | 使用可配置的精简提示词风格 | 关闭 |
| Ponytail 提示词处理 | 采用尽量小改动、完整解决任务的处理风格 | 关闭 |
| 本地响应 | 对支持的探测请求直接返回结果，无需调用 LLM | 关闭 |
| LLM 摘要压缩 | 可选使用 LLM 摘要进行上下文压缩 | 关闭（仅在 `balanced`/`aggressive` 模式下生效） |
| Prompt Cache 稳定性 | 稳定系统提示词各部分的顺序 | 除 `off` 外的所有模式均生效 |
| Web 设置面板 | 在 **Settings → Token Saver** 中配置插件 | DSH Web 可用 |

## 安装

通过 DSH 从 GitHub 仓库安装：

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

如果 DSH/pnpm 要求批准构建脚本，请按终端提示完成授权后重新安装。之后根据当前 DSH 安装方式重新加载或重启目标 profile。

> 本项目以 GitHub 仓库和 GitHub Releases 为准；有固定版本的正式发行版时，建议安装指定版本。

安装当前指定的 v1.0.2 正式版本：

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.2
```

预构建产物 `dsh-token-saver-1.0.2.tgz` 也可从 [v1.0.2 版本发布页](https://github.com/LoveDoLove/dsh-token-saver/releases/tag/v1.0.2) 下载，作为本地包安装，无需本地构建环境。

> v1.0.2 正式版早于 grep 模式修复（commit `8562f48`）。如需当前的生产行为，请从 `main` 安装或固定到更新的 tag。

## 工作方式

DSH Token Saver 接入 DSH 的工具执行流程：

1. **Post-execute 钩子** — 工具返回后，过长的输出会被裁剪为保留开头和结尾；grep 结果会折叠为仅保留匹配项；RTK 可压缩结构化命令输出。
2. **上下文压力处理** — 当上下文压力超过阈值时，更高模式可在下一步之前触发压缩。
3. **LLM 摘要压缩** — 在 `balanced`/`aggressive` 模式下，可用 LLM 摘要替代冗长输出（需要配置 `callLlm` provider）。
4. **Prompt Cache 稳定性** — 重新排序系统提示词各部分，使已固定的缓存片段在多轮之间保持稳定。

所有处理路径均为故障开放（fail-open）：任何优化出错时，原始内容都会被原样保留。

## 配置

在 DSH Web 中打开 **Settings → Token Saver**，即可使用设置面板。也可以通过 DSH bundle 配置文件进行配置。

示例：

```yaml
dsh-token-saver:
  mode: conservative # off | conservative | balanced | aggressive
  rtkEnabled: false
  cavemanLevel: off # off | lite | full | ultra | wenyan-lite | wenyan | wenyan-ultra
  ponytailLevel: off # off | lite | full | ultra
  localResponsesEnabled: false
  localResponses: [quota, prefix, title, suggestion, filepath]
  llmSummaryEnabled: false
```

### 关键配置项

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `mode` | `conservative` | 总开关，见[模式](#模式)。 |
| `headBytes` / `tailBytes` | `16384` / `8192` | 裁剪工具结果时保留的开头与结尾字节数。不超过 `headBytes + tailBytes + 256` 的结果保持原样。 |
| `grepMaxMatches` / `grepContextLines` | `30` / `2` | 折叠 grep 结果时保留的匹配数量，以及每个匹配前后保留的上下文行数。 |
| `grepHeadBytes` / `grepTailBytes` | `8192` / `4096` | 折叠后 grep 结果的字节预算。 |
| `pressureThreshold` | `0.5` | 上下文压力比例，超过该值时更高模式可触发压缩。 |
| `llmSummaryEnabled` | `false` | 仅在 `balanced` 或 `aggressive` 模式下生效，且需要接入 `callLlm` provider。 |
| `replaceBasicCompaction` | `aggressive` 下为 `true` | 用 LLM 摘要引擎替换 DSH 内置的压缩 provider。 |
| `includeToolNames` / `excludeToolNames` | `[]` | 将裁剪限制在指定工具，或跳过指定工具。 |
| `cacheStableSections` | `[]` | 需要固定在首位的系统提示词片段 id，使其在 Prompt Cache 中保持位置稳定。 |

### 模式

- **off**：关闭 Token 优化处理（`rtkEnabled: true` 时 RTK 仍会执行）。
- **conservative**：裁剪或折叠过长的工具输出，同时保留 DSH 原有的常规压缩流程。
- **balanced**：启用更多上下文压力处理。
- **aggressive**：启用更积极的压缩行为（默认会替换基础压缩 provider）；使用前请检查相关配置。

实际行为取决于各项配置和当前安装的 DSH 版本。请以当前版本的设置面板和配置默认值为准。

## 统计信息

Web 设置面板显示实时节省遥测数据，累计统计结果会持久化到 `~/.dsh/token-saver/stats.json`（或 `$DSH_HOME/token-saver/stats.json`），因此主机重启后仪表板仍会显示历史节省情况。

- **已节省** — 所有压缩流程累计减少的字节数。
- **节省比例** — 节省字节数占原始字节数的百分比。
- **生效请求** — 产生至少一个被压缩文本块的压缩调用次数。
- **压缩块数** — 实际被压缩的文本块数量。

同一工具输出可能被压缩两次 —— 一次由 post-execute 钩子执行，另一次由 LLM/流式路径执行 —— 因此 `calls` 统计压缩事件，`blocks` 统计被压缩的文本块。由于每次压缩节省的字节数会累加到总量中，节省字节数保持精确。遥测的读写均为故障开放模式：存储异常不得影响压缩行为。

> v1.0.2 起引入持久化累计节省统计。更早版本每次重启都会将仪表板重置为零。

## 安全行为

- **失败时保留原内容：** 优化过程失败或结果不可用时，保留原始内容。
- **保留错误输出：** 工具输出过滤器不会压缩被标记为错误的结果。
- **额外功能可单独启用：** RTK、提示词处理、本地响应和 LLM 摘要压缩均可独立配置。
- **不保证任务质量完全不变：** Token 优化可能改变模型能看到的信息。尤其启用激进压缩前，应先审查设置。

## 基准测试

已验证的字节减少测量结果（插件 v1.0.2，DSH 0.2.1-rc.2，Node v24.22.0，Linux，模式 `conservative`，`rtkEnabled: false`）。每个场景都是对合成输入的确定性进程内调用，不涉及 DSH 会话或 LLM 请求。完整测试方法与可复现命令见 [docs/benchmark-results.md](docs/benchmark-results.md)，如何复现和报告测量结果见 [docs/benchmark-methodology.md](docs/benchmark-methodology.md)。

| 场景 | 输入字节 | 输出字节 | 节省字节 | 减少比例 |
|---|---:|---:|---:|---:|
| 类读取工具输出（首尾裁剪） | 182,892 | 24,675 | 158,217 | 86.5% |
| 类 grep 工具输出（生产路径，提供模式） | 29,321 | 8,145 | 21,176 | 72.2% |
| 类 grep 工具输出（生产路径，无模式 — fail-open） | 29,321 | 12,321 | 17,000 | 58.0% |
| 提供匹配模式时的 grep 折叠（库能力，19,781 字节输入） | 19,781 | 1,301 | 18,480 | 93.4% |
| RTK 构建输出压缩 | 9,423 | 2,163 | 7,260 | 77.0% |

以上为通过压缩函数在进程内处理合成输入得到的 UTF-8 字节减少量，并非模型 token 数、token 成本节省、延迟改善或任务质量证据。生产环境的 grep 路径现已从 `exec.arguments` 提取搜索模式（commit `8562f48`）；93.4% 为折叠库在另一份更小输入上的能力，而非默认生产路径结果。

各行的可复现性不同：类读取、库级折叠和 RTK 三行可由仓库内已提交的 `npx tsx bench-tmp.ts` 脚本复现；两行 29,321 字节的生产路径数据是在未提交生成脚本的输入上测得的，因此按当前仓库状态无法重新运行。详见基准测试结果文档中的[可复现性说明](docs/benchmark-results.md#reproducibility-status)。

## 兼容性

项目设计上可与以下插件协同使用：

- **Billion Context**：相关输出过滤器会保留带有 ACP 标记的内容。
- **OmniRoute**：设计上保留请求中的路由字段。
- **Our Free Model**：识别 `<!-- ofm-token-saver -->` 标记，避免重复应用提示词处理。

实际兼容性取决于周边插件的版本和配置。反馈问题时请附上相关版本信息及可复现步骤。

## 开发

要求：Node.js `>=22.19.0` 和 pnpm。

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 许可证

MIT，详见 [LICENSE](LICENSE)。从第三方项目衍生的部分保留所需的署名和许可声明，具体请查看源文件及许可证说明。
