# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**面向 DeepSeek Harness（DSH）的可配置 Token 优化插件。**

[English](README.md) · [版本发布](https://github.com/LoveDoLove/dsh-token-saver/releases) · [问题反馈](https://github.com/LoveDoLove/dsh-token-saver/issues)

文件读取、grep 结果、命令日志等大型工具输出会在模型真正需要之前占用 DSH 会话的大部分上下文。DSH Token Saver 用于裁剪这类输出，并提供可选的提示词压缩、上下文压力处理、本地响应和 LLM 摘要压缩。各项优化可以独立配置；额外优化默认关闭，基础模式默认保持保守。

**快速安装。** 运行 `dsh plugin --profile web add github:LoveDoLove/dsh-token-saver`。指定版本安装与构建脚本授权见 [安装](#安装)。

## 功能

| 功能 | 说明 | 默认状态 |
|---|---|---|
| 工具输出裁剪 | 对过长的工具结果保留开头和结尾 | 保守模式启用 |
| Grep 结果折叠 | 折叠大型 grep 输出并保留有用上下文 | 保守模式启用 |
| 上下文压力处理 | 监测上下文压力，并可在更高模式下触发压缩 | 保守模式 |
| RTK 集成 | 通过 RTK 压缩受支持命令的输出 | 关闭 |
| Caveman 提示词处理 | 使用可配置的精简提示词风格 | 关闭 |
| Ponytail 提示词处理 | 采用尽量小改动、完整解决任务的处理风格 | 关闭 |
| 本地响应 | 对支持的探测请求直接返回结果，无需调用 LLM | 关闭 |
| LLM 摘要压缩 | 可选使用 LLM 摘要进行上下文压缩 | 关闭 |
| Prompt Cache 稳定性 | 可选稳定系统提示词各部分的顺序 | 关闭 |
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

### 模式

- **off**：关闭 Token 优化处理。
- **conservative**：裁剪或折叠过长的工具输出，同时保留 DSH 原有的常规压缩流程。
- **balanced**：启用更多上下文压力处理。
- **aggressive**：启用更积极的压缩行为；使用前请检查相关配置。

实际行为取决于各项配置和当前安装的 DSH 版本。请以当前版本的设置面板和配置默认值为准。

## 基准测试

本项目不发布合成基准测试结果。节省量通过下方 [统计信息](#统计信息) 中描述的持久化遥测在真实 DSH 会话中测量；如何复现和报告测量结果请参见 [基准测试方法](docs/benchmark-methodology.md)。

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

已验证的字节减少测量结果（插件 v1.0.2，DSH 0.2.1-rc.2，Node v24.22.0，Linux，模式 `conservative`，`rtkEnabled: false`）。完整测试方法与可复现命令见 [docs/benchmark-results.md](docs/benchmark-results.md)。

| 场景 | 输入字节 | 输出字节 | 节省字节 | 减少比例 |
|---|---:|---:|---:|---:|
| 类读取工具输出（首尾裁剪） | 182,892 | 24,675 | 158,217 | 86.5% |
| 类 grep 工具输出（生产路径，提供模式） | 29,321 | 8,145 | 21,176 | 72.2% |
| 类 grep 工具输出（生产路径，无模式 — fail-open） | 29,321 | 12,321 | 17,000 | 58.0% |
| 提供匹配模式时的 grep 折叠（库能力，19,781 字节输入） | 19,781 | 1,301 | 18,480 | 93.4% |
| RTK 构建输出压缩 | 9,423 | 2,163 | 7,260 | 77.0% |

以上为通过压缩函数在进程内处理合成输入得到的 UTF-8 字节减少量，并非模型 token 数、token 成本节省、延迟改善或任务质量证据。当前生产环境中 grep 路径已从 `exec.arguments` 提取搜索模式（commit `8562f48`），因此“生产路径，提供模式”一行反映修复后的行为；“无模式 — fail-open”一行复现修复前的行为。93.4% 仍为库的上限能力，而非默认行为。

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
