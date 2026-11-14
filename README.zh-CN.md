# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**把更多上下文窗口留给模型。**
一个 DeepSeek Harness 插件：裁剪过大的工具输出，折叠 grep 结果，并按需提供提示词塑形和本地应答。

[English](README.md) · [文档](docs/README.md) · [版本发布](https://github.com/LoveDoLove/dsh-token-saver/releases) · [问题反馈](https://github.com/LoveDoLove/dsh-token-saver/issues)

## 为什么

工具输出是填满上下文窗口最快的方式。一次文件读取、一次 `grep`、一份构建日志，就可能加入模型根本不需要的几万字节，而这些内容会留在对话里，影响之后的每一轮。

Token Saver 工作在 DSH 的工具执行边界：保留长结果的开头和结尾，把搜索结果折叠到匹配项附近，并可按需应用形状感知的 RTK 过滤器。它不触碰用户消息、助手消息和错误结果，并且在出错时放行原始内容。

## 功能

| 功能 | 作用 | 默认 |
|---|---|---|
| 工具输出裁剪 | 保留超大结果的开头和结尾 | 开启 |
| grep 折叠 | 保留匹配行及其上下文 | 开启 |
| RTK 过滤器 | 针对 diff、日志、树、表格的形状感知压缩 | 关闭 |
| Caveman 塑形 | 简洁直接，保留精确代码和路径 | 关闭 |
| Ponytail 塑形 | 最小改动、最小 diff 风格 | 关闭 |
| 本地响应 | 本地回答配额、前缀、标题、建议、文件路径探测 | 关闭 |
| 上下文压力 | 超过阈值时触发压缩 | 关闭 |
| Web 面板 | 在 **设置 → Token Saver** 中配置并查看节省量 | DSH Web 可用 |

所有功能都可以关闭。`mode: off` 会禁用全部工具输出压缩；提示词塑形和本地响应有各自独立的开关。

## 快速开始

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

固定到当前版本：

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.5
```

如果 DSH 要求批准构建脚本，按提示操作后重试。也可以在
[v1.0.5 发布页](https://github.com/LoveDoLove/dsh-token-saver/releases/tag/v1.0.5)
下载预构建的 `dsh-token-saver-1.0.5.tgz`，无需本地构建环境。

> **从 v1.0.4 或更早版本升级？** v1.0.5 修复了 RTK 自动检测中的数据破坏问题，该问题可能把 README 风格的正文压缩成几行。如果你通过工具读取文件，请升级。

## 配置

配置写在 DSH profile 的 bundle 行里。一个典型配置：

```yaml
- id: dsh-token-saver
  name: dsh-token-saver
  config:
    mode: conservative
    headBytes: 16384
    tailBytes: 8192
    rtkEnabled: false
    cavemanLevel: off
    ponytailLevel: off
    localResponsesEnabled: false
```

| 模式 | 行为 |
|---|---|
| `off` | 不裁剪、不折叠、不启用 RTK |
| `conservative` | 只裁剪和折叠，不压缩会话 |
| `balanced` | 在启用时加入压力驱动的压缩 |
| `aggressive` | 与 balanced 相同，但压缩门槛更低 |

Web 面板把实时覆盖写入 `$DSH_HOME/token-saver/settings.json`。全部 22 个选项见[配置文档](docs/configuration.md)。

## 工作方式

1. **`tools/post-execute`** — 判断结果是否需要压缩。错误和结构化值原样通过。
2. **策略** — 按工具和结果形状选择 RTK 过滤器、grep 折叠或字节预算截断。
3. **`ctx.systemPrompt.section()`** — 把 Caveman 或 Ponytail 文本作为提示词 section 注入。冻结的 LLM 请求不会被改写。
4. **`llm/stream`** — 对识别出的探测请求在本地回答，usage 为零；其余情况原样通过。

## 安全

- 错误结果永不压缩。
- 只有非空且严格更小的结果才会被采用。
- 所有策略出错时放行原始内容。
- 提示词文本走受支持的 section API，不使用组装瀑布。
- agent 循环的 LLM 请求永不被修改。
- 非法配置在激活时失败，而不是被静默转换。

## 基准测试

合成测试数据上的 UTF-8 字节：

| 场景 | 压缩前 | 压缩后 | 节省 |
|---|---:|---:|---:|
| 大 diff | 182,892 | 24,675 | 86.5% |
| grep 结果 | 29,321 | 8,145 | 72.2% |
| find 结果 | 29,321 | 12,321 | 58.0% |
| 构建日志 | 19,781 | 1,301 | 93.4% |
| 表格 | 9,423 | 2,163 | 77.0% |

字节不是 token。方法见[基准测试方法](docs/benchmark-methodology.md)。

## 文档

- [白皮书](docs/whitepaper.zh-CN.md) · [Whitepaper](docs/whitepaper.md)
- [架构](docs/architecture.md)
- [配置](docs/configuration.md)
- [工具输出压缩](docs/tool-output-compression.md)
- [提示词塑形](docs/prompt-shaping.md)
- [本地响应](docs/local-responses.md)
- [统计](docs/statistics.md)
- [兼容性](docs/compatibility.md)
- [开发](docs/development.md)

## 兼容性

面向 DSH `>=0.2.0 <0.3.0` 和 Node `>=22.19.0`。可与 Billion Context、OmniRoute、Our Free Model 共存。详情见[兼容性文档](docs/compatibility.md)。

## 开发

```bash
pnpm install
pnpm prepack
```

`pnpm prepack` 依次运行 lint、类型检查、测试、构建和包校验。Agent 指南见 [AGENTS.md](AGENTS.md)。

## 许可证

MIT
