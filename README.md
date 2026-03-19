# Opencode Qoder Provider

[English](#english) | [中文](#中文)

---

<a name="english"></a>
## English

Opencode plugin for Qoder AI provider. This plugin integrates Qoder AI models into the Opencode CLI, allowing you to use Qoder's powerful AI capabilities directly from your command line.

### Features

- Multiple Qoder AI models (Auto, Efficient, Performance, Ultimate, Lite, and more)
- Streaming response support
- Tool calling capabilities
- Image/multimodal input support
- Fully bundled SDK (no external dependencies on `@ali/qoder-agent-sdk`)

### Prerequisites

Before using this plugin, you need to:

1. **Install Qoder CLI**
   ```bash
   # Install via npm (recommended)
   npm install -g @ali/qoder-cli

   # Or install via bun
   bun install -g @ali/qoder-cli
   ```

2. **Login to Qoder**
   ```bash
   qoder login
   ```
   This will open a browser window for authentication. Follow the prompts to complete the login.

3. **Verify installation**
   ```bash
   qoder --version
   ```

### Installation

#### As an Opencode Plugin

1. Clone this repository:
   ```bash
   git clone https://github.com/yee88/opencode-qoder-provider.git
   cd opencode-qoder-provider
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Link or copy the plugin to your Opencode plugins directory:
   ```bash
   # Option 1: Create a symlink (recommended for development)
   ln -s $(pwd) ~/.config/opencode/plugins/opencode-qoder-provider

   # Option 2: Copy the directory
   cp -r . ~/.config/opencode/plugins/opencode-qoder-provider
   ```

4. Configure Opencode to use the plugin. Add to your `~/.config/opencode/config.json`:
   ```json
   {
     "plugins": [
       "opencode-qoder-provider"
     ],
     "provider": {
       "qoder": {
         "name": "Qoder",
         "models": {
           "auto": {
             "id": "auto",
             "name": "Auto (1.0x)",
             "attachment": true,
             "reasoning": true,
             "temperature": false,
             "tool_call": true
           }
         }
       }
     }
   }
   ```

### Usage

Once installed, you can use Qoder models in Opencode:

```bash
# Use default model
opencode chat --provider qoder

# Use specific model
opencode chat --provider qoder --model auto
opencode chat --provider qoder --model efficient
opencode chat --provider qoder --model performance
opencode chat --provider qoder --model ultimate
opencode chat --provider qoder --model lite
```

### Available Models

| Model ID | Name | Context | Output | Features |
|----------|------|---------|--------|----------|
| `auto` | Auto (1.0x) | 200K | 32K | attachment, reasoning, tool_call |
| `efficient` | Efficient (0.3x) | 200K | 32K | attachment, tool_call |
| `performance` | Performance (1.1x) | 200K | 32K | attachment, reasoning, tool_call |
| `ultimate` | Ultimate (1.6x) | 200K | 32K | attachment, reasoning, tool_call |
| `lite` | Lite (0x) | 100K | 16K | tool_call |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 200K | 32K | attachment, reasoning, tool_call |
| `q35model` | Qwen3.5-Plus (0.2x) | 200K | 32K | attachment, tool_call |
| `gmodel` | GLM-5 (0.5x) | 1M | 32K | attachment, reasoning, tool_call |
| `kmodel` | Kimi-K2.5 (0.3x) | 256K | 32K | reasoning, tool_call |
| `mmodel` | MiniMax-M2.7 (0.2x) | 200K | 32K | tool_call |

### Troubleshooting

**Qoder CLI not found**
- Make sure `qoder` is in your PATH: `which qoder`
- If not found, reinstall: `npm install -g @ali/qoder-cli`

**Authentication errors**
- Run `qoder login` again to refresh your session
- Check your Qoder account status at https://qoder.com

**Plugin not loading**
- Verify the plugin path in your Opencode config
- Check Opencode logs: `opencode --verbose`

### License

MIT License - see [LICENSE](./LICENSE) file for details.

---

<a name="中文"></a>
## 中文

Opencode 的 Qoder AI Provider 插件。此插件将 Qoder AI 模型集成到 Opencode CLI 中，让您可以直接从命令行使用 Qoder 的强大 AI 能力。

### 功能特性

- 支持多种 Qoder AI 模型（Auto、Efficient、Performance、Ultimate、Lite 等）
- 流式响应支持
- 工具调用能力
- 图片/多模态输入支持
- SDK 完全打包（不依赖外部 `@ali/qoder-agent-sdk`）

### 前置要求

在使用此插件之前，您需要：

1. **安装 Qoder CLI**
   ```bash
   # 通过 npm 安装（推荐）
   npm install -g @ali/qoder-cli

   # 或通过 bun 安装
   bun install -g @ali/qoder-cli
   ```

2. **登录 Qoder**
   ```bash
   qoder login
   ```
   这将打开浏览器窗口进行认证。按照提示完成登录。

3. **验证安装**
   ```bash
   qoder --version
   ```

### 安装方法

#### 作为 Opencode 插件

1. 克隆此仓库：
   ```bash
   git clone https://github.com/yee88/opencode-qoder-provider.git
   cd opencode-qoder-provider
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 将插件链接或复制到 Opencode 插件目录：
   ```bash
   # 选项 1：创建符号链接（开发推荐）
   ln -s $(pwd) ~/.config/opencode/plugins/opencode-qoder-provider

   # 选项 2：复制目录
   cp -r . ~/.config/opencode/plugins/opencode-qoder-provider
   ```

4. 配置 Opencode 使用此插件。添加到 `~/.config/opencode/config.json`：
   ```json
   {
     "plugins": [
       "opencode-qoder-provider"
     ],
     "provider": {
       "qoder": {
         "name": "Qoder",
         "models": {
           "auto": {
             "id": "auto",
             "name": "Auto (1.0x)",
             "attachment": true,
             "reasoning": true,
             "temperature": false,
             "tool_call": true
           }
         }
       }
     }
   }
   ```

### 使用方法

安装完成后，您可以在 Opencode 中使用 Qoder 模型：

```bash
# 使用默认模型
opencode chat --provider qoder

# 使用特定模型
opencode chat --provider qoder --model auto
opencode chat --provider qoder --model efficient
opencode chat --provider qoder --model performance
opencode chat --provider qoder --model ultimate
opencode chat --provider qoder --model lite
```

### 可用模型

| 模型 ID | 名称 | 上下文长度 | 输出长度 | 功能特性 |
|---------|------|-----------|---------|---------|
| `auto` | Auto (1.0x) | 200K | 32K | 附件、推理、工具调用 |
| `efficient` | Efficient (0.3x) | 200K | 32K | 附件、工具调用 |
| `performance` | Performance (1.1x) | 200K | 32K | 附件、推理、工具调用 |
| `ultimate` | Ultimate (1.6x) | 200K | 32K | 附件、推理、工具调用 |
| `lite` | Lite (0x) | 100K | 16K | 工具调用 |
| `qmodel` | Qwen-Coder-Qoder-1.0 (0.2x) | 200K | 32K | 附件、推理、工具调用 |
| `q35model` | Qwen3.5-Plus (0.2x) | 200K | 32K | 附件、工具调用 |
| `gmodel` | GLM-5 (0.5x) | 1M | 32K | 附件、推理、工具调用 |
| `kmodel` | Kimi-K2.5 (0.3x) | 256K | 32K | 推理、工具调用 |
| `mmodel` | MiniMax-M2.7 (0.2x) | 200K | 32K | 工具调用 |

### 故障排除

**找不到 Qoder CLI**
- 确保 `qoder` 在您的 PATH 中：`which qoder`
- 如果未找到，重新安装：`npm install -g @ali/qoder-cli`

**认证错误**
- 再次运行 `qoder login` 刷新会话
- 在 https://qoder.com 检查您的 Qoder 账户状态

**插件未加载**
- 验证 Opencode 配置中的插件路径
- 检查 Opencode 日志：`opencode --verbose`

### 许可证

MIT 许可证 - 详情见 [LICENSE](./LICENSE) 文件。
