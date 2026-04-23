# opencode-qoder-auth

[English](#english) | [中文](#中文)

> An [opencode](https://opencode.ai) plugin that brings **Qoder AI** models into your terminal — fully bundled, zero manual provider configuration required.

---

<a name="english"></a>
## English

### Quick Start

```bash
# 1. Login to Qoder CLI
qodercli login

# 2. Install the opencode plugin
opencode plugin opencode-qoder-auth

# 3. Verify qoder models are available
opencode models | grep qoder
```

If the last command prints `qoder/...` models, the plugin has already injected the `qoder` provider and model definitions for you. No manual `provider.qoder` config is needed.

### Prerequisites

#### 1. Install & login to Qoder CLI

```bash
qodercli login
```

This opens a browser for OAuth. Credentials are stored at `~/.qoder/.auth/user`.

#### 2. Install opencode

```bash
npm install -g opencode-ai
```

---

### Installation

When you run opencode inside this repository, the repo-local plugin entry at `.opencode/plugins/qoder-auth.ts` is auto-discovered, so `opencode models qoder` works without extra setup.

For normal end users outside this repository, OpenCode installs npm plugins automatically on startup from the `plugin` array below.

Dependencies are fully vendored for Qoder SDK access, so `npm install`, `pnpm install`, and `bun install` should not need to fetch `@ali/qoder-agent-sdk` from the public npm registry.

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-qoder-auth"]
}
```

OpenCode installs npm plugins automatically on startup. Once this package name is present in `plugin`, the plugin injects the `qoder` provider and all 11 models — no `provider` block needed.

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
| `q35model_preview` | Qwen3.6-plus-preview (0x) | 180K | 32K | ✓ | ✗ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 180K | 32K | ✓ | ✗ |
| `q35model` | Qwen3.5-Plus (0.2x) | 180K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 180K | 32K | ✓ | ✗ |
| `kmodel` | Kimi-K2.5 (0.3x) | 180K | 32K | ✓ | ✗ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 180K | 32K | ✓ | ✗ |

---

### Auth

The plugin reads `~/.qoder/.auth/user` to detect login state. If not logged in, opencode will show a prompt: *"Run `qodercli login` in your terminal to authenticate"*.

---

### Known Limitations

- Image input now uses an attachment fallback in the vendored SDK: when the prompt contains base64 image blocks, the plugin rewrites them into temporary files and calls `qodercli --attachment ... --print ...`.
- This is a compatibility workaround for the current SDK streaming query path, which still does not reliably deliver image blocks end-to-end.
- `attachment` in model definitions reflects model-side capability; end-to-end image support in this plugin currently depends on the attachment fallback path.

### TODO

- Replace the attachment fallback once the upstream SDK/CLI streaming path can consume image blocks directly.
- Keep `npm run vendor:patch-sdk` in the SDK refresh workflow after updating `src/vendor/qoder-agent-sdk.mjs`.

### Release Flow

- Every push to `main` or `master` runs CI tests automatically.
- When the push lands on `main` / `master`, CI also bumps the patch version automatically, publishes to npm, then commits `package.json` + `package-lock.json` and pushes the release tag back to the repository.
- Configure `NPM_TOKEN` in GitHub Actions secrets before using this flow.

---

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Auth prompt at startup | Run `qodercli login`, then restart opencode |
| `qodercli not found` | Install Qoder CLI; `~/.qoder/bin/qodercli/` must exist |
| Model not found | Verify model ID matches the table above |

---

### License

MIT — see [LICENSE](./LICENSE)

---

<a name="中文"></a>
## 中文

### 快速开始

```bash
# 1. 先登录 qoder-cli
qodercli login

# 2. 安装 opencode 插件
opencode plugin opencode-qoder-auth

# 3. 验证 qoder 模型已注入
opencode models | grep qoder
```

如果最后一条命令能输出 `qoder/...` 模型，说明插件已经自动注入 `qoder` provider 和模型定义，不需要手写 `provider.qoder` 配置。

### 前置条件

#### 1. 安装并登录 Qoder CLI

```bash
qodercli login
```

会打开浏览器进行 OAuth 认证，凭证存储在 `~/.qoder/.auth/user`。

#### 2. 安装 opencode

```bash
npm install -g opencode-ai
```

---

### 安装

如果你是在这个仓库目录里直接运行 opencode，仓库自带的 `.opencode/plugins/qoder-auth.ts` 会被自动发现，因此 `opencode models qoder` 不需要额外配置就能工作。

如果你是在仓库外作为普通用户使用，OpenCode 会在启动时按下面的 `plugin` 数组自动安装 npm 插件。

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": ["opencode-qoder-auth"]
}
```

OpenCode 会在启动时自动安装 `plugin` 数组里的 npm 插件。只要这里写上 `opencode-qoder-auth`，插件就会自动注入完整的 `qoder` provider 和全部 11 个模型，**无需手写任何 `provider` 配置**。

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
| `q35model_preview` | Qwen3.6-plus-preview (0x) | 180K | 32K | ✓ | ✗ |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 180K | 32K | ✓ | ✗ |
| `q35model` | Qwen3.5-Plus (0.2x) | 180K | 32K | ✓ | ✗ |
| `gmodel` | GLM-5 (0.5x) | 180K | 32K | ✓ | ✗ |
| `kmodel` | Kimi-K2.5 (0.3x) | 180K | 32K | ✓ | ✗ |
| `mmodel` | MiniMax-M2.7 (0.2x) | 180K | 32K | ✓ | ✗ |

---

### 认证说明

插件通过检查 `~/.qoder/.auth/user` 判断登录状态。若未登录，opencode 会弹出提示：*先在终端运行 `qodercli login`*。

---

### 已知限制

- 当前图片输入通过 vendored SDK 的 fallback 方案支持：遇到 base64 image block 时，会先落临时文件，再改用 `qodercli --attachment ... --print ...` 调用。
- 这属于对当前 SDK streaming query 链路的兼容修复；上游直传 image block 的路径仍不稳定。
- 模型定义中的 `attachment` 字段表示模型侧能力；本插件端到端图片支持当前依赖上述 attachment fallback。

### TODO

- 等上游 SDK / CLI 的 streaming path 能直接消费 image block 后，再移除当前 fallback。
- 以后更新 `src/vendor/qoder-agent-sdk.mjs` 后，重新执行 `npm run vendor:patch-sdk` 以应用兼容补丁。

### 发布流程

- 每次推送到 `main` 或 `master` 都会自动执行 CI 测试。
- 当代码进入 `main` / `master` 时，CI 会自动把版本号的 patch 位（Z 位）加 1，发布到 npm，并把更新后的 `package.json`、`package-lock.json` 以及对应 tag 提交回仓库。
- 使用前需要先在 GitHub Actions Secrets 中配置 `NPM_TOKEN`。

---

### 常见问题

| 问题 | 解决方法 |
|------|---------|
| 启动时弹出 auth 提示 | 运行 `qodercli login`，重启 opencode |
| `qodercli not found` | 安装 Qoder CLI，确保 `~/.qoder/bin/qodercli/` 存在 |
| 模型找不到 | 检查模型 ID 是否与上表一致 |

---

### 许可证

MIT — 详见 [LICENSE](./LICENSE)
