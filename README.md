# opencode-qoder-plugin

[English](#english) | [中文](#中文)

> An [opencode](https://opencode.ai) plugin that brings **Qoder AI** models into your terminal — fully bundled, zero manual provider configuration required.

---

<a name="english"></a>
## English

### Prerequisites

#### 1. Install & login to Qoder CLI

```bash
qoder login
```

This opens a browser for OAuth. Credentials are stored at `~/.qoder/.auth/user`.

#### 2. Install opencode

```bash
npm install -g opencode-ai
```

---

### Installation

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-qoder-plugin"]
}
```

That's it. The plugin automatically injects the `qoder` provider and all 10 models — no `provider` block needed.

---

### Usage

```bash
# Free lite model
opencode run -m qoder/lite "say hello"

# Auto model (paid)
opencode run -m qoder/auto "explain async/await"

# Interactive session
opencode -m qoder/auto
```

---

### Available Models

| Model ID | Name | Context | Output | Attachment | Reasoning |
|----------|------|---------|--------|-----------|-----------|
| `lite` | Lite — **free** | 180K | 32K | ✗ | ✗ |
| `auto` | Auto (1.0x) | 180K | 32K | ✓ | ✗ |
| `efficient` | Efficient (0.3x) | 180K | 32K | ✓ | ✗ |
| `performance` | Performance (1.1x) | 180K | 32K | ✓ | ✗ |
| `ultimate` | Ultimate (1.6x) | 180K | 32K | ✓ | ✓ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 180K | 32K | ✓ | ✗ |
| `q35model` | Qwen3.5-Plus (0.2x) | 180K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 180K | 32K | ✓ | ✗ |
| `kmodel` | Kimi-K2.5 (0.3x) | 180K | 32K | ✓ | ✗ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 180K | 32K | ✓ | ✗ |

---

### Auth

The plugin reads `~/.qoder/.auth/user` to detect login state. If not logged in, opencode will show a prompt: *"Run `qoder login` in your terminal to authenticate"*.

---

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Auth prompt at startup | Run `qoder login`, then restart opencode |
| `qodercli not found` | Install Qoder CLI; `~/.qoder/bin/qodercli/` must exist |
| Model not found | Verify model ID matches the table above |

---

### License

MIT — see [LICENSE](./LICENSE)

---

<a name="中文"></a>
## 中文

### 前置条件

#### 1. 安装并登录 Qoder CLI

```bash
qoder login
```

会打开浏览器进行 OAuth 认证，凭证存储在 `~/.qoder/.auth/user`。

#### 2. 安装 opencode

```bash
npm install -g opencode-ai
```

---

### 安装

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": ["opencode-qoder-plugin"]
}
```

就这样。插件会自动注入完整的 `qoder` provider 和所有模型，**无需手写任何 `provider` 配置**。

---

### 使用方法

```bash
# 免费 lite 模型
opencode run -m qoder/lite "说你好"

# auto 模型（付费）
opencode run -m qoder/auto "解释 async/await"

# 交互式会话
opencode -m qoder/auto
```

---

### 可用模型

| 模型 ID | 名称 | 上下文 | 输出 | 附件 | 推理 |
|---------|------|-------|------|-----|-----|
| `lite` | Lite — **免费** | 180K | 32K | ✗ | ✗ |
| `auto` | Auto (1.0x) | 180K | 32K | ✓ | ✗ |
| `efficient` | Efficient (0.3x) | 180K | 32K | ✓ | ✗ |
| `performance` | Performance (1.1x) | 180K | 32K | ✓ | ✗ |
| `ultimate` | Ultimate (1.6x) | 180K | 32K | ✓ | ✓ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 180K | 32K | ✓ | ✗ |
| `q35model` | Qwen3.5-Plus (0.2x) | 180K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 180K | 32K | ✓ | ✗ |
| `kmodel` | Kimi-K2.5 (0.3x) | 180K | 32K | ✓ | ✗ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 180K | 32K | ✓ | ✗ |

---

### 认证说明

插件通过检查 `~/.qoder/.auth/user` 判断登录状态。若未登录，opencode 会弹出提示：*先在终端运行 `qoder login`*。

---

### 常见问题

| 问题 | 解决方法 |
|------|---------|
| 启动时弹出 auth 提示 | 运行 `qoder login`，重启 opencode |
| `qodercli not found` | 安装 Qoder CLI，确保 `~/.qoder/bin/qodercli/` 存在 |
| 模型找不到 | 检查模型 ID 是否与上表一致 |

---

### 许可证

MIT — 详见 [LICENSE](./LICENSE)
