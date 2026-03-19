# opencode-qoder-provider

[English](#english) | [中文](#中文)

> An [opencode](https://opencode.ai) plugin that brings **Qoder AI** models into your terminal — fully bundled, no internal registries required.

---

<a name="english"></a>
## English

### Features

- 10 Qoder AI models: Auto, Efficient, Performance, Ultimate, Lite, Qwen-Coder, Qwen3.5-Plus, GLM-5, Kimi-K2.5, MiniMax-M2.7
- Streaming response support (AI SDK V2 protocol)
- Tool calling & multimodal (image) input
- **Fully vendored SDK** — zero dependency on internal `@ali/qoder-agent-sdk` registry

---

### Prerequisites

#### 1. Install Qoder CLI

Download and install the Qoder CLI from the official site:

```bash
# macOS / Linux — download the latest binary from https://qoder.com/download
# or install via npm if available on your registry:
npm install -g @ali/qoder-cli
```

After installation, verify:

```bash
qoder --version
```

The CLI binary will be placed at `~/.qoder/bin/qodercli/qodercli-<version>`.

#### 2. Login to Qoder

```bash
qoder login
```

This opens a browser window for authentication. Complete the OAuth flow. Credentials are stored at `~/.qoder/.auth/user`.

#### 3. Install opencode

```bash
npm install -g opencode-ai
# or
bun install -g opencode-ai
```

---

### Installation

```bash
git clone https://github.com/yee88/opencode-qoder-provider.git
cd opencode-qoder-provider
npm install
```

---

### Configuration

Add the plugin to your opencode config at `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    {
      "npm": "file:///absolute/path/to/opencode-qoder-provider"
    }
  ],
  "provider": {
    "qoder": {
      "name": "Qoder",
      "npm": "file:///absolute/path/to/opencode-qoder-provider/provider.ts",
      "models": {
        "auto":        { "id": "auto",        "name": "Auto (1.0x)",                  "attachment": true,  "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "efficient":   { "id": "efficient",   "name": "Efficient (0.3x)",             "attachment": true,  "reasoning": false, "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "performance": { "id": "performance", "name": "Performance (1.1x)",           "attachment": true,  "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "ultimate":    { "id": "ultimate",    "name": "Ultimate (1.6x)",              "attachment": true,  "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "lite":        { "id": "lite",        "name": "Lite (0x — free)",             "attachment": false, "reasoning": false, "temperature": false, "tool_call": true,  "limit": { "context": 100000, "output": 16000 } },
        "qmodel":      { "id": "qmodel",      "name": "Qwen-Coder-Qoder-1.0 (0.2x)", "attachment": true,  "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "q35model":    { "id": "q35model",    "name": "Qwen3.5-Plus (0.2x)",          "attachment": true,  "reasoning": false, "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } },
        "gmodel":      { "id": "gmodel",      "name": "GLM-5 (0.5x)",                "attachment": true,  "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 1000000,"output": 32000 } },
        "kmodel":      { "id": "kmodel",      "name": "Kimi-K2.5 (0.3x)",            "attachment": false, "reasoning": true,  "temperature": false, "tool_call": true,  "limit": { "context": 256000, "output": 32000 } },
        "mmodel":      { "id": "mmodel",      "name": "MiniMax-M2.7 (0.2x)",         "attachment": false, "reasoning": false, "temperature": false, "tool_call": true,  "limit": { "context": 200000, "output": 32000 } }
      }
    }
  }
}
```

> **Tip:** Replace `/absolute/path/to/opencode-qoder-provider` with the actual path where you cloned this repo.

---

### Usage

```bash
# Quick one-shot query (free lite model)
opencode run -m qoder/lite "say hello"

# Use the auto model (paid)
opencode run -m qoder/auto "explain how async/await works"

# Interactive session
opencode -m qoder/auto
```

---

### Available Models

| Model ID | Name | Context | Output | Attachment | Reasoning |
|----------|------|---------|--------|-----------|-----------|
| `lite` | Lite (0x — **free**) | 100K | 16K | ✗ | ✗ |
| `auto` | Auto (1.0x) | 200K | 32K | ✓ | ✓ |
| `efficient` | Efficient (0.3x) | 200K | 32K | ✓ | ✗ |
| `performance` | Performance (1.1x) | 200K | 32K | ✓ | ✓ |
| `ultimate` | Ultimate (1.6x) | 200K | 32K | ✓ | ✓ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 200K | 32K | ✓ | ✓ |
| `q35model` | Qwen3.5-Plus (0.2x) | 200K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 1M | 32K | ✓ | ✓ |
| `kmodel` | Kimi-K2.5 (0.3x) | 256K | 32K | ✗ | ✓ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 200K | 32K | ✗ | ✗ |

`lite` is the only **free** model; all others require a paid Qoder subscription.

---

### Architecture

```
opencode-qoder-provider/
├── index.ts                    # Plugin entry — injects provider.qoder via config hook
├── provider.ts                 # Exports createQoderProvider() (opencode loader entry)
├── src/
│   ├── models.ts               # 10 model definitions
│   ├── qoder-language-model.ts # LanguageModelV2 implementation (doGenerate + doStream)
│   ├── prompt-builder.ts       # AI SDK CallOptions → Qoder prompt string
│   └── vendor/
│       ├── qoder-agent-sdk.mjs # Bundled Qoder Agent SDK (no external registry needed)
│       └── qoder-agent-sdk.d.ts
└── tests/
    ├── models.test.ts
    ├── plugin.test.ts
    ├── qoder-language-model.test.ts
    └── integration/
        ├── real-api.test.ts        # Requires ~/.qoder/.auth/user
        └── opencode-cli.test.ts
```

---

### Development & Testing

```bash
# Unit tests (25 tests, no network required)
npm test

# Integration tests (requires Qoder login)
npx vitest run tests/integration/real-api.test.ts
```

---

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `qodercli not found` | Make sure Qoder CLI is installed and `~/.qoder/bin/qodercli/` exists |
| `Authentication error` | Run `qoder login` to refresh credentials |
| `Model not found` | Check the model ID in your `opencode.json` matches the table above |
| `Plugin not loading` | Verify the `file://` path is absolute and the directory exists |

---

### License

MIT — see [LICENSE](./LICENSE)

---

<a name="中文"></a>
## 中文

### 简介

将 **Qoder AI** 的 10 个模型接入 [opencode](https://opencode.ai) 终端的插件。SDK 完整打包，无需访问内部 registry。

---

### 前置条件

#### 1. 安装 Qoder CLI

从官网 [https://qoder.com/download](https://qoder.com) 下载并安装 Qoder CLI：

```bash
# 如果你的 registry 有此包
npm install -g @ali/qoder-cli
```

安装后验证：

```bash
qoder --version
```

CLI 二进制文件会安装到 `~/.qoder/bin/qodercli/qodercli-<版本号>`。

#### 2. 登录 Qoder

```bash
qoder login
```

会打开浏览器进行 OAuth 认证，完成后凭证存储在 `~/.qoder/.auth/user`。

#### 3. 安装 opencode

```bash
npm install -g opencode-ai
# 或
bun install -g opencode-ai
```

---

### 安装

```bash
git clone https://github.com/yee88/opencode-qoder-provider.git
cd opencode-qoder-provider
npm install
```

---

### 配置

在 `~/.config/opencode/opencode.json` 中添加插件配置：

```json
{
  "plugins": [
    {
      "npm": "file:///你的绝对路径/opencode-qoder-provider"
    }
  ],
  "provider": {
    "qoder": {
      "name": "Qoder",
      "npm": "file:///你的绝对路径/opencode-qoder-provider/provider.ts",
      "models": {
        "lite": { "id": "lite", "name": "Lite (0x — 免费)", "attachment": false, "reasoning": false, "temperature": false, "tool_call": true, "limit": { "context": 100000, "output": 16000 } },
        "auto": { "id": "auto", "name": "Auto (1.0x)", "attachment": true, "reasoning": true, "temperature": false, "tool_call": true, "limit": { "context": 200000, "output": 32000 } }
      }
    }
  }
}
```

> 将 `你的绝对路径` 替换为仓库实际克隆路径。

---

### 使用方法

```bash
# 免费 lite 模型快速查询
opencode run -m qoder/lite "说你好"

# 使用 auto 模型（付费）
opencode run -m qoder/auto "解释一下 async/await 的工作原理"

# 交互式会话
opencode -m qoder/auto
```

---

### 可用模型

| 模型 ID | 名称 | 上下文 | 输出 | 附件 | 推理 |
|---------|------|-------|------|-----|-----|
| `lite` | Lite (0x — **免费**) | 100K | 16K | ✗ | ✗ |
| `auto` | Auto (1.0x) | 200K | 32K | ✓ | ✓ |
| `efficient` | Efficient (0.3x) | 200K | 32K | ✓ | ✗ |
| `performance` | Performance (1.1x) | 200K | 32K | ✓ | ✓ |
| `ultimate` | Ultimate (1.6x) | 200K | 32K | ✓ | ✓ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 200K | 32K | ✓ | ✓ |
| `q35model` | Qwen3.5-Plus (0.2x) | 200K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 1M | 32K | ✓ | ✓ |
| `kmodel` | Kimi-K2.5 (0.3x) | 256K | 32K | ✗ | ✓ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 200K | 32K | ✗ | ✗ |

`lite` 是唯一**免费**模型，其余需要付费套餐。

---

### 开发与测试

```bash
# 单元测试（25 个，无需网络）
npm test

# 集成测试（需要 Qoder 登录）
npx vitest run tests/integration/real-api.test.ts
```

---

### 常见问题

| 问题 | 解决方法 |
|------|---------|
| `qodercli not found` | 确保 Qoder CLI 已安装，`~/.qoder/bin/qodercli/` 目录存在 |
| 认证错误 | 运行 `qoder login` 刷新凭证 |
| 模型找不到 | 检查 `opencode.json` 中的模型 ID 是否与上表一致 |
| 插件未加载 | 确认 `file://` 路径为绝对路径且目录存在 |

---

### 许可证

MIT — 详见 [LICENSE](./LICENSE)
