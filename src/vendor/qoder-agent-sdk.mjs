import { spawn } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';

// package.json
var package_default = {
  version: "0.0.24"};

// src/version.ts
var VERSION = package_default.version;

// src/config.ts
var IntegrationMode = /* @__PURE__ */ ((IntegrationMode2) => {
  IntegrationMode2["QoderWork"] = "qoder_work";
  IntegrationMode2["Quest"] = "quest";
  return IntegrationMode2;
})(IntegrationMode || {});
var globalConfig = {};
function configure(config) {
  globalConfig = { ...globalConfig, ...config };
}
function getConfig() {
  return { ...globalConfig };
}

// src/errors.ts
var QoderAgentSDKError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "QoderAgentSDKError";
  }
};
var CLIConnectionError = class extends QoderAgentSDKError {
  constructor(message = "Unable to connect to Qoder") {
    super(message);
    this.name = "CLIConnectionError";
  }
};
var CLINotFoundError = class extends CLIConnectionError {
  cliPath;
  constructor(message = "Qoder not found", cliPath) {
    super(cliPath ? `${message}: ${cliPath}` : message);
    this.name = "CLINotFoundError";
    this.cliPath = cliPath;
  }
};
var ProcessError = class extends QoderAgentSDKError {
  exitCode;
  stderr;
  constructor(message, exitCode, stderr) {
    let fullMessage = message;
    if (exitCode !== void 0) {
      fullMessage = `${message} (exit code: ${exitCode})`;
    }
    if (stderr) {
      fullMessage = `${fullMessage}
Error output: ${stderr}`;
    }
    super(fullMessage);
    this.name = "ProcessError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
};
var CLIJSONDecodeError = class extends QoderAgentSDKError {
  line;
  originalError;
  constructor(line, originalError) {
    super(`Failed to decode JSON: ${line.slice(0, 100)}...`);
    this.name = "CLIJSONDecodeError";
    this.line = line;
    this.originalError = originalError;
  }
};
var MessageParseError = class extends QoderAgentSDKError {
  data;
  constructor(message, data) {
    super(message);
    this.name = "MessageParseError";
    this.data = data;
  }
};
var ControlRequestTimeoutError = class extends QoderAgentSDKError {
  subtype;
  constructor(subtype) {
    super(`Control request timeout: ${subtype}`);
    this.name = "ControlRequestTimeoutError";
    this.subtype = subtype;
  }
};

function buildPreparedPromptFromMessages(messages, createTempFile) {
  const promptParts = [];
  const attachments = [];
  if (!Array.isArray(messages)) {
    return {
      promptText: "Please analyze the attached file(s).",
      attachments
    };
  }
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.type !== "user") {
      continue;
    }
    const content = msg.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    const textParts = [];
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        textParts.push(block.text);
      } else if (block.type === "image") {
        const source = block.source;
        if (source?.type === "base64" && typeof source.data === "string" && source.data.length > 0) {
          attachments.push(createTempFile(source.data, source.media_type));
        }
      }
    }
    if (textParts.length > 0) {
      promptParts.push(textParts.join("\n"));
    }
  }
  return {
    promptText: promptParts.join("\n\n").trim() || "Please analyze the attached file(s).",
    attachments
  };
}
function mediaTypeToExtension(mediaType) {
  switch ((mediaType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}
async function* replayMessages(messages) {
  for (const message of messages) {
    yield message;
  }
}

// src/internal/subprocess-transport.ts
var DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;
process.platform === "win32" ? 8e3 : 1e5;
var SubprocessTransport = class {
  prompt;
  isStreaming;
  options;
  cliPath;
  cwd;
  process = null;
  stdoutReader = null;
  ready = false;
  exitError = null;
  maxBufferSize;
  tempFiles = [];
  writeLock = false;
  preparedPromptText = null;
  preparedAttachments = [];
  usePreparedNonStreaming = false;
  constructor({ prompt, options }) {
    this.prompt = prompt;
    this.isStreaming = typeof prompt !== "string";
    this.options = options;
    if (options.pathToQoderCLIExecutable) {
      this.cliPath = options.pathToQoderCLIExecutable;
      console.log(`[SDK] Using Qoder CLI from options.pathToQoderCLIExecutable: ${this.cliPath}`);
    } else {
      this.cliPath = this.findCli();
    }
    this.cwd = options.cwd;
    this.maxBufferSize = DEFAULT_MAX_BUFFER_SIZE;
  }
  /**
   * Find Qoder CLI binary
   */
  findCli() {
    const bundledCli = this.findBundledCli();
    if (bundledCli) {
      console.log(`[SDK] Using Qoder CLI from bundled: ${bundledCli}`);
      return bundledCli;
    }
    const envPath = process.env.PATH || "";
    const pathDirs = envPath.split(path.delimiter);
    const cliName = process.platform === "win32" ? "qoder.exe" : "qoder";
    for (const dir of pathDirs) {
      const cliPath = path.join(dir, cliName);
      if (fs.existsSync(cliPath)) {
        console.log(`[SDK] Using Qoder CLI from PATH: ${cliPath}`);
        return cliPath;
      }
    }
    const homeDir = os.homedir();
    const locations = [
      path.join(homeDir, ".npm-global", "bin", "qoder"),
      "/usr/local/bin/qoder",
      path.join(homeDir, ".local", "bin", "qoder"),
      path.join(homeDir, "node_modules", ".bin", "qoder"),
      path.join(homeDir, ".yarn", "bin", "qoder"),
      path.join(homeDir, ".qoder", "local", "qoder")
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        console.log(`[SDK] Using Qoder CLI from common location: ${loc}`);
        return loc;
      }
    }
    throw new CLINotFoundError(
      `Qoder CLI not found. Install with:
  npm install -g @anthropic-ai/qoder-code

If already installed locally, try:
  export PATH="$HOME/node_modules/.bin:$PATH"

Or provide the path via options:
  options.pathToQoderCLIExecutable = '/path/to/qoder-cli'`
    );
  }
  /**
   * Find bundled CLI binary if it exists
   */
  findBundledCli() {
    const cliName = process.platform === "win32" ? "qoder.exe" : "qoder";
    const bundledPath = path.join(__dirname, "..", "_bundled", cliName);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    return null;
  }
  /**
   * Build settings value, merging sandbox settings if provided
   */
  buildSettingsValue() {
    const hasSandbox = this.options.sandbox !== void 0;
    if (!hasSandbox) {
      return null;
    }
    const settingsObj = {};
    if (hasSandbox) {
      settingsObj.sandbox = this.options.sandbox;
    }
    return JSON.stringify(settingsObj);
  }
  /**
   * Build CLI command with arguments
   */
  buildCommand() {
    const cmd = [this.cliPath, "--output-format", "stream-json", "--verbose"];
    const config = getConfig();
    const storageDir = this.options.storageDir ?? config.storageDir;
    if (storageDir) {
      cmd.push("--storage-dir", storageDir);
    }
    const resourceDir = this.options.resourceDir ?? config.resourceDir;
    if (resourceDir) {
      cmd.push("--resource-dir", resourceDir);
    }
    if (this.options.tools !== void 0) {
      if (Array.isArray(this.options.tools)) {
        if (this.options.tools.length === 0) {
          cmd.push("--tools", "");
        } else {
          cmd.push("--tools", this.options.tools.join(","));
        }
      } else {
        cmd.push("--tools", "default");
      }
    }
    if (this.options.allowedTools && this.options.allowedTools.length > 0) {
      cmd.push("--allowed-tools", this.options.allowedTools.join(","));
    }
    if (this.options.maxTurns !== void 0) {
      cmd.push("--max-turns", String(this.options.maxTurns));
    }
    if (this.options.maxBudgetUsd !== void 0) {
      cmd.push("--max-budget-usd", String(this.options.maxBudgetUsd));
    }
    if (this.options.disallowedTools && this.options.disallowedTools.length > 0) {
      cmd.push("--disallowed-tools", this.options.disallowedTools.join(","));
    }
    if (this.options.model) {
      cmd.push("--model", this.options.model);
    }
    if (this.options.fallbackModel) {
      cmd.push("--fallback-model", this.options.fallbackModel);
    }
    if (this.options.betas && this.options.betas.length > 0) {
      cmd.push("--betas", this.options.betas.join(","));
    }
    if (this.options.permissionMode && this.options.permissionMode === "bypassPermissions") {
      cmd.push("--yolo");
    }
    if (this.options.continue) {
      cmd.push("--continue");
    }
    if (this.options.resume) {
      cmd.push("--resume", this.options.resume);
    }
    if (this.options.resumeSessionAt) {
      cmd.push("--resume-session-at", this.options.resumeSessionAt);
    }
    const settingsValue = this.buildSettingsValue();
    if (settingsValue) {
      cmd.push("--settings", settingsValue);
    }
    if (this.options.additionalDirectories) {
      for (const dir of this.options.additionalDirectories) {
        cmd.push("--add-dir", dir);
      }
    }
    if (this.options.mcpServers) {
      const serversForCli = {};
      for (const [name, config2] of Object.entries(this.options.mcpServers)) {
        if ("type" in config2 && config2.type === "sdk") {
          const sdkConfig = config2;
          serversForCli[name] = {
            type: sdkConfig.type,
            name: sdkConfig.name
          };
        } else {
          serversForCli[name] = config2;
        }
      }
      if (Object.keys(serversForCli).length > 0) {
        cmd.push("--mcp-config", JSON.stringify({ mcpServers: serversForCli }));
      }
    }
    if (this.options.includePartialMessages) {
      cmd.push("--include-partial-messages");
    }
    if (this.options.forkSession) {
      cmd.push("--fork-session");
    }
    if (this.options.agents) {
      const agentsDict = {};
      for (const [name, agentDef] of Object.entries(this.options.agents)) {
        const agentObj = {
          description: agentDef.description,
          prompt: agentDef.prompt
        };
        if (agentDef.tools) agentObj.tools = agentDef.tools;
        if (agentDef.model) agentObj.model = agentDef.model;
        agentsDict[name] = agentObj;
      }
      cmd.push("--agents", JSON.stringify(agentsDict));
    }
    if (this.options.settingSources !== void 0) {
      const sourcesValue = this.options.settingSources.join(",");
      cmd.push("--setting-sources", sourcesValue);
    }
    if (this.options.plugins) {
      for (const plugin of this.options.plugins) {
        if (plugin.type === "local") {
          cmd.push("--plugin-dir", plugin.path);
        }
      }
    }
    if (this.options.extraArgs) {
      for (const [flag, value] of Object.entries(this.options.extraArgs)) {
        if (value === null) {
          cmd.push(`--${flag}`);
        } else {
          cmd.push(`--${flag}`, String(value));
        }
      }
    }
    if (this.options.maxThinkingTokens !== void 0) {
      cmd.push("--max-thinking-tokens", String(this.options.maxThinkingTokens));
    }
    if (this.options.outputFormat && this.options.outputFormat.type === "json_schema") {
      cmd.push("--json-schema", JSON.stringify(this.options.outputFormat.schema));
    }
    if (this.usePreparedNonStreaming) {
      for (const attachment of this.preparedAttachments) {
        cmd.push("--attachment", attachment);
      }
      cmd.push("--print", this.preparedPromptText ?? "Please analyze the attached file(s).");
    } else if (this.isStreaming) {
      cmd.push("--input-format", "stream-json");
    } else {
      cmd.push("--print", String(this.prompt));
    }
    console.log(`[SDK] Running command: ${cmd.join(" ")}`);
    return cmd;
  }
  async connect() {
    if (this.process) {
      return;
    }
    const cmd = this.buildCommand();
    try {
      const processEnv = {
        ...process.env,
        ...this.options.env || {},
        QODER_ENTRYPOINT: "sdk-ts"
      };
      if (this.options.enableFileCheckpointing) {
        processEnv.QODER_ENABLE_SDK_FILE_CHECKPOINTING = "true";
      }
      const config = getConfig();
      const integrationMode = this.options.integrationMode ?? config.integrationMode;
      if (integrationMode) {
        processEnv.QODERCLI_INTEGRATION_MODE = integrationMode;
      }
      if (this.cwd) {
        processEnv.PWD = this.cwd;
      }
      const [executable, ...args] = cmd;
      console.log(`[SDK] Spawning subprocess: ${executable}`);
      console.log(`[SDK] Working directory: ${this.cwd || process.cwd()}`);
      console.log(`Platform: ${process.platform}`);
      const spawnOptions = {
        cwd: this.cwd,
        env: processEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        // Only use detached on non-Windows platforms
        detached: process.platform !== "win32"
      };
      console.log(`Spawn options:`, JSON.stringify({
        windowsHide: spawnOptions.windowsHide,
        shell: spawnOptions.shell,
        detached: spawnOptions.detached,
        stdio: spawnOptions.stdio
      }));
      this.process = spawn(executable, args, spawnOptions);
      console.log(`[SDK] Subprocess spawned with PID: ${this.process.pid}`);
      if (this.process.stdout) {
        this.stdoutReader = createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity
        });
      }
      let stderrBuffer = [];
      if (this.process.stderr) {
        const stderrReader = createInterface({
          input: this.process.stderr,
          crlfDelay: Infinity
        });
        stderrReader.on("line", (line) => {
          console.error(`[SDK] stderr: ${line}`);
          stderrBuffer.push(line);
          if (stderrBuffer.length > 50) {
            stderrBuffer.shift();
          }
          if (this.options.stderr) {
            this.options.stderr(line);
          }
        });
      }
      this.process.on("error", (err) => {
        console.error(`[SDK] Subprocess error event:`, err);
        console.error(`[SDK] Executable path: ${executable}`);
        console.error(`[SDK] Error code: ${err.code}`);
        if (err.code === "ENOENT") {
          console.error(`[SDK] Executable not found at path: ${executable}`);
        } else if (err.code === "EACCES") {
          console.error(`[SDK] Permission denied for executable: ${executable}`);
        }
        if (stderrBuffer.length > 0) {
          console.error(`[SDK] Stderr output before error:
${stderrBuffer.join("\n")}`);
        }
        this.exitError = new CLIConnectionError(`Failed to start Qoder: ${err.message}`);
        this.ready = false;
      });
      this.process.on("exit", (code, signal) => {
        console.log(`[SDK] Subprocess exited with code: ${code}, signal: ${signal}`);
        if (code !== null && code !== 0) {
          console.error(`[SDK] Subprocess failed with exit code: ${code}`);
          console.error(`[SDK] CLI path used: ${executable}`);
          console.error(`[SDK] Arguments: ${args.join(" ")}`);
          console.error(`[SDK] Working directory: ${this.cwd || process.cwd()}`);
          console.error(`[SDK] Environment QODER_ENTRYPOINT: ${processEnv.QODER_ENTRYPOINT}`);
          if (processEnv.QODERCLI_INTEGRATION_MODE) {
            console.error(`[SDK] Environment QODERCLI_INTEGRATION_MODE: ${processEnv.QODERCLI_INTEGRATION_MODE}`);
          }
          if (stderrBuffer.length > 0) {
            console.error(`[SDK] Stderr output (${stderrBuffer.length} lines):
${stderrBuffer.join("\n")}`);
          } else {
            console.error(`[SDK] No stderr output captured`);
          }
          this.exitError = new ProcessError("Command failed", code);
        }
        this.ready = false;
      });
      if ((!this.isStreaming || this.usePreparedNonStreaming) && this.process.stdin) {
        this.process.stdin.end();
      }
      this.ready = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[SDK] Failed to spawn subprocess:`, error);
      console.error(`[SDK] CLI path: ${this.cliPath}`);
      console.error(`[SDK] Working directory: ${this.cwd || "not set"}`);
      if (this.cwd && !fs.existsSync(this.cwd)) {
        console.error(`[SDK] Working directory does not exist: ${this.cwd}`);
        throw new CLIConnectionError(`Working directory does not exist: ${this.cwd}`);
      }
      if (!fs.existsSync(this.cliPath)) {
        console.error(`[SDK] CLI executable not found at: ${this.cliPath}`);
      } else {
        try {
          const stats = fs.statSync(this.cliPath);
          console.error(`[SDK] CLI file stats - mode: ${stats.mode.toString(8)}, size: ${stats.size}`);
        } catch (statErr) {
          console.error(`[SDK] Failed to stat CLI: ${statErr}`);
        }
      }
      throw new CLIConnectionError(`Failed to start Qoder: ${error.message}`);
    }
  }
  async write(data) {
    if (this.writeLock) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return this.write(data);
    }
    this.writeLock = true;
    try {
      if (!this.ready || !this.process?.stdin) {
        throw new CLIConnectionError("ProcessTransport is not ready for writing");
      }
      if (this.exitError) {
        throw new CLIConnectionError(
          `Cannot write to process that exited with error: ${this.exitError.message}`
        );
      }
      await new Promise((resolve, reject) => {
        this.process.stdin.write(data, (err) => {
          if (err) {
            this.ready = false;
            this.exitError = new CLIConnectionError(
              `Failed to write to process stdin: ${err.message}`
            );
            reject(this.exitError);
          } else {
            resolve();
          }
        });
      });
    } finally {
      this.writeLock = false;
    }
  }
  async *readMessages() {
    if (!this.process || !this.stdoutReader) {
      throw new CLIConnectionError("Not connected");
    }
    let jsonBuffer = "";
    try {
      for await (const line of this.stdoutReader) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        jsonBuffer += trimmedLine;
        if (jsonBuffer.length > this.maxBufferSize) {
          const bufferLength = jsonBuffer.length;
          jsonBuffer = "";
          throw new CLIJSONDecodeError(
            `JSON message exceeded maximum buffer size of ${this.maxBufferSize} bytes`,
            new Error(`Buffer size ${bufferLength} exceeds limit ${this.maxBufferSize}`)
          );
        }
        try {
          const data = JSON.parse(jsonBuffer);
          jsonBuffer = "";
          yield data;
        } catch {
          continue;
        }
      }
    } catch (err) {
      if (err instanceof CLIJSONDecodeError) {
        throw err;
      }
    }
    if (this.process.exitCode !== null && this.process.exitCode !== 0) {
      throw new ProcessError(
        "Command failed",
        this.process.exitCode,
        "Check stderr output for details"
      );
    }
  }
  async close() {
    for (const tempFile of this.tempFiles) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
    }
    this.tempFiles = [];
    if (!this.process) {
      this.ready = false;
      return;
    }
    this.ready = false;
    if (this.process.stdin) {
      try {
        this.process.stdin.end();
      } catch {
      }
    }
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }
    if (this.process.exitCode === null) {
      this.process.kill("SIGTERM");
    }
    this.process = null;
    this.exitError = null;
  }
  async endInput() {
    if (this.process?.stdin) {
      try {
        this.process.stdin.end();
      } catch {
      }
    }
  }
  isReady() {
    return this.ready;
  }
  shouldUsePreparedNonStreamingMode() {
    return this.usePreparedNonStreaming;
  }
  createTempAttachmentFile(base64Data, mediaType) {
    const extension = mediaTypeToExtension(mediaType);
    const hash = createHash("sha256").update(base64Data).digest("hex").slice(0, 12);
    const filePath = path.join(
      os.tmpdir(),
      `qoder-sdk-attachment-${process.pid}-${Date.now()}-${hash}${extension}`
    );
    fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
    this.tempFiles.push(filePath);
    return filePath;
  }
  async queryPrepare(messages) {
    const prepared = buildPreparedPromptFromMessages(
      messages,
      (base64Data, mediaType) => this.createTempAttachmentFile(base64Data, mediaType)
    );
    if (prepared.attachments.length === 0) {
      return;
    }
    this.preparedPromptText = prepared.promptText;
    this.preparedAttachments = prepared.attachments;
    this.usePreparedNonStreaming = true;
  }
};

// src/internal/message-parser.ts
function parseContentBlock(block) {
  const blockType = block.type;
  switch (blockType) {
    case "text":
      return {
        type: "text",
        text: block.text
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: block.thinking
      };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input
      };
    default:
      return {
        type: "text",
        text: JSON.stringify(block)
      };
  }
}
function parseMessage(data) {
  if (!data || typeof data !== "object") {
    throw new MessageParseError(
      `Invalid message data type (expected object, got ${typeof data})`,
      data
    );
  }
  const messageType = data.type;
  if (!messageType) {
    throw new MessageParseError("Message missing 'type' field", data);
  }
  switch (messageType) {
    case "user": {
      try {
        const message = data.message;
        const messageContent = message?.content;
        const userMessage = {
          type: "user",
          uuid: data.uuid,
          session_id: data.session_id,
          message: {
            role: "user",
            content: Array.isArray(messageContent) ? messageContent.map((block) => {
              if (block.type === "text") {
                return { type: "text", text: block.text };
              }
              if (block.type === "tool_result") {
                return {
                  type: "tool_result",
                  tool_use_id: block.tool_use_id,
                  content: block.content,
                  is_error: block.is_error
                };
              }
              if (block.type === "image") {
                return {
                  type: "image",
                  source: block.source
                };
              }
              return { type: "text", text: JSON.stringify(block) };
            }) : [{ type: "text", text: messageContent }]
          },
          parent_tool_use_id: data.parent_tool_use_id ?? null
        };
        return userMessage;
      } catch (e) {
        throw new MessageParseError(
          `Missing required field in user message: ${e}`,
          data
        );
      }
    }
    case "assistant": {
      try {
        const message = data.message;
        const rawContent = message?.content;
        const content = rawContent.map(parseContentBlock);
        return {
          type: "assistant",
          uuid: data.uuid,
          session_id: data.session_id,
          message: {
            role: "assistant",
            content
          },
          parent_tool_use_id: data.parent_tool_use_id ?? null
        };
      } catch (e) {
        throw new MessageParseError(
          `Missing required field in assistant message: ${e}`,
          data
        );
      }
    }
    case "system": {
      try {
        const subtype = data.subtype;
        if (subtype === "compact_boundary") {
          return {
            type: "system",
            subtype: "compact_boundary",
            uuid: data.uuid,
            session_id: data.session_id,
            compact_metadata: data.compact_metadata
          };
        }
        return {
          type: "system",
          subtype: data.subtype,
          uuid: data.uuid,
          session_id: data.session_id,
          apiKeySource: data.apiKeySource,
          cwd: data.cwd,
          tools: data.tools,
          mcp_servers: data.mcp_servers,
          model: data.model,
          permissionMode: data.permissionMode,
          slash_commands: data.slash_commands,
          output_style: data.output_style
        };
      } catch (e) {
        throw new MessageParseError(
          `Missing required field in system message: ${e}`,
          data
        );
      }
    }
    case "result": {
      try {
        const subtype = data.subtype;
        if (subtype === "success") {
          return {
            type: "result",
            subtype: "success",
            uuid: data.uuid,
            session_id: data.session_id,
            duration_ms: data.duration_ms,
            duration_api_ms: data.duration_api_ms,
            is_error: data.is_error,
            num_turns: data.num_turns,
            result: data.result,
            total_cost_usd: data.total_cost_usd,
            usage: data.usage,
            modelUsage: data.modelUsage,
            permission_denials: data.permission_denials ?? [],
            structured_output: data.structured_output
          };
        }
        return {
          type: "result",
          subtype,
          uuid: data.uuid,
          session_id: data.session_id,
          duration_ms: data.duration_ms,
          duration_api_ms: data.duration_api_ms,
          is_error: data.is_error,
          num_turns: data.num_turns,
          total_cost_usd: data.total_cost_usd,
          usage: data.usage,
          modelUsage: data.modelUsage,
          permission_denials: data.permission_denials ?? [],
          errors: data.errors ?? []
        };
      } catch (e) {
        throw new MessageParseError(
          `Missing required field in result message: ${e}`,
          data
        );
      }
    }
    case "stream_event": {
      try {
        const streamEvent = {
          type: "stream_event",
          event: data.event,
          parent_tool_use_id: data.parent_tool_use_id ?? null,
          uuid: data.uuid,
          session_id: data.session_id
        };
        return streamEvent;
      } catch (e) {
        throw new MessageParseError(
          `Missing required field in stream_event message: ${e}`,
          data
        );
      }
    }
    default:
      throw new MessageParseError(`Unknown message type: ${messageType}`, data);
  }
}

// src/internal/query-handler.ts
function convertHookOutputForCli(hookOutput) {
  const converted = {};
  for (const [key, value] of Object.entries(hookOutput)) {
    if (key === "async_") {
      converted["async"] = value;
    } else if (key === "continue_") {
      converted["continue"] = value;
    } else {
      converted[key] = value;
    }
  }
  return converted;
}
var QueryHandler = class {
  transport;
  isStreamingMode;
  canUseTool;
  hooks;
  sdkMcpServers;
  initializeTimeout;
  // Control protocol state
  pendingControlResponses = /* @__PURE__ */ new Map();
  hookCallbacks = /* @__PURE__ */ new Map();
  nextCallbackId = 0;
  requestCounter = 0;
  // Message stream
  messageQueue = [];
  messageResolvers = [];
  initialized = false;
  closed = false;
  initializationResult = null;
  // Track first result for proper stream closure
  firstResultReceived = false;
  firstResultResolvers = [];
  // Background tasks
  readingMessages = false;
  constructor(options) {
    this.transport = options.transport;
    this.isStreamingMode = options.isStreamingMode;
    this.canUseTool = options.canUseTool;
    this.hooks = options.hooks ?? {};
    this.sdkMcpServers = options.sdkMcpServers ?? {};
    this.initializeTimeout = options.initializeTimeout ?? 60;
  }
  /**
   * Initialize control protocol if in streaming mode
   */
  async initialize() {
    if (!this.isStreamingMode) {
      return null;
    }
    const hooksConfig = {};
    for (const [event, matchers] of Object.entries(this.hooks)) {
      if (matchers && matchers.length > 0) {
        hooksConfig[event] = [];
        for (const matcher of matchers) {
          const callbackIds = [];
          for (const callback of matcher.hooks) {
            const callbackId = `hook_${this.nextCallbackId++}`;
            this.hookCallbacks.set(callbackId, callback);
            callbackIds.push(callbackId);
          }
          const hookMatcherConfig = {
            matcher: matcher.matcher ?? null,
            hookCallbackIds: callbackIds
          };
          hooksConfig[event].push(hookMatcherConfig);
        }
      }
    }
    const request = {
      subtype: "initialize",
      hooks: Object.keys(hooksConfig).length > 0 ? hooksConfig : null
    };
    const response = await this.sendControlRequest(request, this.initializeTimeout);
    this.initialized = true;
    this.initializationResult = response;
    return response;
  }
  /**
   * Start reading messages from transport
   */
  async start() {
    if (this.readingMessages) return;
    this.readingMessages = true;
    this.readMessagesLoop().catch((err) => {
      console.error("Fatal error in message reader:", err);
      this.enqueueMessage({ type: "error", error: String(err) });
    });
  }
  /**
   * Background message reading loop
   */
  async readMessagesLoop() {
    try {
      for await (const message of this.transport.readMessages()) {
        if (this.closed) break;
        const msgType = message.type;
        if (msgType === "control_response") {
          const controlResponse = message;
          const response = controlResponse.response;
          const requestId = response.request_id;
          const pending = this.pendingControlResponses.get(requestId);
          if (pending) {
            this.pendingControlResponses.delete(requestId);
            if (response.subtype === "error") {
              pending.reject(new Error(response.error ?? "Unknown error"));
            } else {
              pending.resolve(response.response ?? {});
            }
          }
          continue;
        }
        if (msgType === "control_request") {
          this.handleControlRequest(message).catch((err) => {
            console.error("Error handling control request:", err);
          });
          continue;
        }
        if (msgType === "control_cancel_request") {
          continue;
        }
        if (msgType === "result") {
          this.firstResultReceived = true;
          for (const resolver of this.firstResultResolvers) {
            resolver();
          }
          this.firstResultResolvers = [];
        }
        this.enqueueMessage(message);
      }
    } catch (err) {
      for (const [requestId, pending] of this.pendingControlResponses) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      this.pendingControlResponses.clear();
      this.enqueueMessage({ type: "error", error: String(err) });
    } finally {
      this.enqueueMessage({ type: "end" });
    }
  }
  /**
   * Enqueue a message for consumers
   */
  enqueueMessage(message) {
    if (this.messageResolvers.length > 0) {
      const resolver = this.messageResolvers.shift();
      resolver({ value: message, done: false });
    } else {
      this.messageQueue.push(message);
    }
  }
  /**
   * Handle incoming control request from CLI
   */
  async handleControlRequest(request) {
    const requestId = request.request_id;
    const requestData = request.request;
    const subtype = requestData.subtype;
    try {
      let responseData = {};
      if (subtype === "can_use_tool") {
        const permissionRequest = requestData;
        const originalInput = permissionRequest.input;
        if (!this.canUseTool) {
          throw new Error("canUseTool callback is not provided");
        }
        const result = await this.canUseTool(
          permissionRequest.tool_name,
          originalInput,
          {
            signal: new AbortController().signal,
            suggestions: permissionRequest.permission_suggestions,
            toolUseID: requestId
            // Pass tool use ID for tracking
          }
        );
        if (result.behavior === "allow") {
          responseData = {
            behavior: "allow",
            updatedInput: result.updatedInput ?? originalInput
          };
          if (result.updatedPermissions) {
            responseData.updatedPermissions = result.updatedPermissions.map((p) => {
              const update = { type: p.type };
              if ("rules" in p && p.rules) {
                update.rules = p.rules.map((r) => ({
                  toolName: r.toolName,
                  ruleContent: r.ruleContent
                }));
              }
              if ("behavior" in p && p.behavior) update.behavior = p.behavior;
              if ("mode" in p && p.mode) update.mode = p.mode;
              if ("directories" in p && p.directories) update.directories = p.directories;
              if ("destination" in p) update.destination = p.destination;
              return update;
            });
          }
        } else {
          responseData = {
            behavior: "deny",
            message: result.message
          };
          if (result.interrupt) {
            responseData.interrupt = result.interrupt;
          }
        }
      } else if (subtype === "hook_callback") {
        const hookRequest = requestData;
        const callback = this.hookCallbacks.get(hookRequest.callback_id);
        if (!callback) {
          throw new Error(`No hook callback found for ID: ${hookRequest.callback_id}`);
        }
        const hookOutput = await callback(
          hookRequest.input,
          hookRequest.tool_use_id,
          { signal: new AbortController().signal }
        );
        responseData = convertHookOutputForCli(hookOutput);
      } else if (subtype === "mcp_message") {
        const serverName = requestData.server_name;
        const mcpMessage = requestData.message;
        if (!serverName || !mcpMessage) {
          throw new Error("Missing server_name or message for MCP request");
        }
        const mcpResponse = await this.handleSdkMcpRequest(serverName, mcpMessage);
        responseData = { mcp_response: mcpResponse };
      } else {
        throw new Error(`Unsupported control request subtype: ${subtype}`);
      }
      const successResponse = {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: responseData
        }
      };
      await this.transport.write(JSON.stringify(successResponse) + "\n");
    } catch (err) {
      const errorResponse = {
        type: "control_response",
        response: {
          subtype: "error",
          request_id: requestId,
          error: err instanceof Error ? err.message : String(err)
        }
      };
      await this.transport.write(JSON.stringify(errorResponse) + "\n");
    }
  }
  /**
   * Send control request to CLI and wait for response
   */
  async sendControlRequest(request, timeout = 60) {
    if (!this.isStreamingMode) {
      throw new Error("Control requests require streaming mode");
    }
    const requestId = `req_${++this.requestCounter}_${Math.random().toString(16).slice(2, 10)}`;
    const responsePromise = new Promise((resolve, reject) => {
      this.pendingControlResponses.set(requestId, { resolve, reject });
    });
    const controlRequest = {
      type: "control_request",
      request_id: requestId,
      request
    };
    await this.transport.write(JSON.stringify(controlRequest) + "\n");
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        this.pendingControlResponses.delete(requestId);
        reject(new ControlRequestTimeoutError(request.subtype));
      }, timeout * 1e3);
    });
    return Promise.race([responsePromise, timeoutPromise]);
  }
  /**
   * Handle an MCP request for an SDK server
   */
  async handleSdkMcpRequest(serverName, message) {
    if (!(serverName in this.sdkMcpServers)) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Server '${serverName}' not found`
        }
      };
    }
    this.sdkMcpServers[serverName];
    const method = message.method;
    message.params ?? {};
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: serverName,
              version: "1.0.0"
            }
          }
        };
      }
      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [] }
        };
      }
      if (method === "tools/call") {
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [] }
        };
      }
      if (method === "notifications/initialized") {
        return { jsonrpc: "2.0", result: {} };
      }
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method '${method}' not found` }
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
      };
    }
  }
  /**
   * Send interrupt control request
   */
  async interrupt() {
    await this.sendControlRequest({ subtype: "interrupt" });
  }
  /**
   * Change permission mode
   */
  async setPermissionMode(mode) {
    await this.sendControlRequest({
      subtype: "set_permission_mode",
      mode
    });
  }
  /**
   * Change the AI model
   */
  async setModel(model) {
    await this.sendControlRequest({
      subtype: "set_model",
      model: model ?? null
    });
  }
  /**
   * Change max thinking tokens
   */
  async setMaxThinkingTokens(maxThinkingTokens) {
    await this.sendControlRequest({
      subtype: "set_max_thinking_tokens",
      max_thinking_tokens: maxThinkingTokens
    });
  }
  /**
   * Rewind tracked files to their state at a specific user message
   */
  async rewindFiles(userMessageId) {
    await this.sendControlRequest({
      subtype: "rewind_files",
      user_message_id: userMessageId
    });
  }
  /**
   * Send an account operation control request to CLI.
   *
   * @param operation - The account operation type
   * @param data - Optional operation-specific data (required for feedback)
   * @param timeout - Timeout in seconds (default: 30s, login: 300s)
   * @returns AccountOperationResponse with success status and data
   */
  async sendAccountOperation(operation, data, timeout) {
    const effectiveTimeout = timeout ?? (operation === "login" ? 300 : 30);
    const request = {
      subtype: "account_operation",
      operation
    };
    if (data !== void 0) {
      request.data = data;
    }
    const response = await this.sendControlRequest(request, effectiveTimeout);
    const opResponse = response;
    return {
      success: opResponse.success ?? false,
      operation: opResponse.operation ?? operation,
      data: opResponse.data,
      error: opResponse.error
    };
  }
  /**
   * Stream input messages to transport
   */
  async streamInput(stream) {
    try {
      const messages = [];
      for await (const message of stream) {
        if (this.closed) break;
        messages.push(message);
      }
      await this.transport.queryPrepare(messages);
      for (const message of messages) {
        if (this.closed) break;
        await this.transport.write(JSON.stringify(message) + "\n");
      }
      const hasHooks = Object.keys(this.hooks).length > 0;
      const hasCanUseTool = !!this.canUseTool;
      if (Object.keys(this.sdkMcpServers).length > 0 || hasHooks || hasCanUseTool) {
        if (!this.firstResultReceived) {
          await new Promise((resolve) => {
            if (this.firstResultReceived) {
              resolve();
            } else {
              this.firstResultResolvers.push(resolve);
            }
          });
        }
      }
      await this.transport.endInput();
    } catch (err) {
      console.debug("Error streaming input:", err);
    }
  }
  /**
   * Receive SDK messages (not control messages)
   */
  async *receiveMessages() {
    while (true) {
      let message;
      if (this.messageQueue.length > 0) {
        message = this.messageQueue.shift();
      } else {
        message = await new Promise((resolve) => {
          this.messageResolvers.push((result) => resolve(result.value));
        });
      }
      if (message.type === "end") {
        break;
      }
      if (message.type === "error") {
        throw new Error(message.error ?? "Unknown error");
      }
      yield parseMessage(message);
    }
  }
  /**
   * Receive raw messages (for internal use)
   */
  async *receiveRawMessages() {
    while (true) {
      let message;
      if (this.messageQueue.length > 0) {
        message = this.messageQueue.shift();
      } else {
        message = await new Promise((resolve) => {
          this.messageResolvers.push((result) => resolve(result.value));
        });
      }
      if (message.type === "end") {
        break;
      }
      if (message.type === "error") {
        throw new Error(message.error ?? "Unknown error");
      }
      yield message;
    }
  }
  /**
   * Get initialization result
   */
  getInitializationResult() {
    return this.initializationResult;
  }
  /**
   * Close the query and transport
   */
  async close() {
    this.closed = true;
    await this.transport.close();
  }
};

// src/query.ts
function query(params) {
  const { prompt, options = {}, transport: customTransport } = params;
  process.env.QODER_ENTRYPOINT = "sdk-ts";
  let configuredOptions = { ...options };
  const isStreaming = typeof prompt !== "string";
  let finalPrompt = prompt;
  let isStreamingMode = isStreaming;
  if (options.canUseTool) {
    if (options.permissionPromptToolName) {
      throw new Error(
        "canUseTool callback cannot be used with permissionPromptToolName. Please use one or the other."
      );
    }
    if (!isStreaming) {
      const stringPrompt = prompt;
      async function* stringToAsyncIterable() {
        yield {
          type: "user",
          session_id: "default",
          message: { role: "user", content: [{ type: "text", text: stringPrompt }] },
          parent_tool_use_id: null
        };
      }
      finalPrompt = stringToAsyncIterable();
      isStreamingMode = true;
    }
    configuredOptions = { ...configuredOptions, permissionPromptToolName: "stdio" };
  }
  let transport = null;
  let queryHandler = null;
  let runtime = null;
  async function prepareRuntime() {
    if (runtime) {
      return runtime;
    }
    let preparedPrompt = finalPrompt;
    let effectiveStreamingMode = isStreamingMode;
    let preparedMessages = null;
    if (isStreamingMode) {
      preparedMessages = [];
      for await (const message of finalPrompt) {
        preparedMessages.push(message);
      }
    }
    preparedPrompt = preparedMessages ? replayMessages(preparedMessages) : finalPrompt;
    transport = customTransport ?? new SubprocessTransport({
      prompt: preparedPrompt,
      options: configuredOptions
    });
    if (preparedMessages && transport instanceof SubprocessTransport) {
      await transport.queryPrepare(preparedMessages);
      preparedPrompt = replayMessages(preparedMessages);
      if (typeof transport.shouldUsePreparedNonStreamingMode === "function" && transport.shouldUsePreparedNonStreamingMode()) {
        effectiveStreamingMode = false;
      }
    }
    const sdkMcpServers = {};
    if (configuredOptions.mcpServers) {
      for (const [name, config] of Object.entries(configuredOptions.mcpServers)) {
        if ("type" in config && config.type === "sdk" && "instance" in config) {
          sdkMcpServers[name] = config.instance;
        }
      }
    }
    queryHandler = new QueryHandler({
      transport,
      isStreamingMode: effectiveStreamingMode,
      canUseTool: configuredOptions.canUseTool,
      hooks: configuredOptions.hooks,
      sdkMcpServers
    });
    runtime = {
      prompt: preparedPrompt,
      isStreamingMode: effectiveStreamingMode
    };
    return runtime;
  }
  let started = false;
  async function* createGenerator() {
    try {
      const preparedRuntime = await prepareRuntime();
      await transport.connect();
      await queryHandler.start();
      if (preparedRuntime.isStreamingMode) {
        await queryHandler.initialize();
      }
      if (preparedRuntime.isStreamingMode) {
        queryHandler.streamInput(preparedRuntime.prompt).catch(() => {
        });
      }
      started = true;
      for await (const message of queryHandler.receiveMessages()) {
        yield message;
      }
    } finally {
      await queryHandler.close();
    }
  }
  const generator = createGenerator();
  const queryObject = {
    // AsyncGenerator methods
    async next(...args) {
      return generator.next(...args);
    },
    async return(value) {
      return generator.return(value);
    },
    async throw(e) {
      return generator.throw(e);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    // Query-specific methods
    async interrupt() {
      const preparedRuntime = await prepareRuntime();
      if (!preparedRuntime.isStreamingMode) {
        throw new Error("interrupt() is only available in streaming mode");
      }
      await queryHandler.interrupt();
    },
    async rewindFiles(userMessageUuid) {
      if (!options.enableFileCheckpointing) {
        throw new Error(
          "File checkpointing is not enabled. Set enableFileCheckpointing: true in options."
        );
      }
      await queryHandler.rewindFiles(userMessageUuid);
    },
    async setPermissionMode(mode) {
      const preparedRuntime = await prepareRuntime();
      if (!preparedRuntime.isStreamingMode) {
        throw new Error("setPermissionMode() is only available in streaming mode");
      }
      await queryHandler.setPermissionMode(mode);
    },
    async setModel(model) {
      const preparedRuntime = await prepareRuntime();
      if (!preparedRuntime.isStreamingMode) {
        throw new Error("setModel() is only available in streaming mode");
      }
      await queryHandler.setModel(model);
    },
    async setMaxThinkingTokens(maxThinkingTokens) {
      const preparedRuntime = await prepareRuntime();
      if (!preparedRuntime.isStreamingMode) {
        throw new Error("setMaxThinkingTokens() is only available in streaming mode");
      }
      await queryHandler.setMaxThinkingTokens(maxThinkingTokens);
    },
    async supportedCommands() {
      if (!queryHandler) {
        return [];
      }
      const initResult = queryHandler.getInitializationResult();
      if (initResult?.commands) {
        return initResult.commands;
      }
      return [];
    },
    async supportedModels() {
      if (!queryHandler) {
        return [];
      }
      const initResult = queryHandler.getInitializationResult();
      if (initResult?.models) {
        return initResult.models;
      }
      return [];
    },
    async mcpServerStatus() {
      if (!queryHandler) {
        return [];
      }
      const initResult = queryHandler.getInitializationResult();
      if (initResult?.mcp_servers) {
        return initResult.mcp_servers;
      }
      return [];
    },
    async accountInfo() {
      if (!queryHandler) {
        return {};
      }
      const initResult = queryHandler.getInitializationResult();
      if (initResult?.account) {
        return initResult.account;
      }
      return {};
    }
  };
  return queryObject;
}
var DEFAULT_MAX_BUFFER_SIZE2 = 1024 * 1024;
var DEFAULT_SOCAT_COMMAND = "/Applications/QoderWork.app/Contents/Resources/bin/socat";
var DEFAULT_CHAT_ENDPOINT = "192.168.64.10:1024";
var SocatTransport = class {
  prompt;
  isStreaming;
  options;
  process = null;
  stdoutReader = null;
  ready = false;
  exitError = null;
  maxBufferSize;
  writeLock = false;
  socatCommand;
  chatEndpoint;
  constructor({ prompt, options, socatCommand, chatEndpoint, apiBaseUrl }) {
    this.prompt = prompt;
    this.isStreaming = typeof prompt !== "string";
    this.options = options;
    this.maxBufferSize = DEFAULT_MAX_BUFFER_SIZE2;
    this.socatCommand = socatCommand || DEFAULT_SOCAT_COMMAND;
    this.chatEndpoint = chatEndpoint || DEFAULT_CHAT_ENDPOINT;
  }
  async connect() {
    if (this.process) {
      return;
    }
    try {
      const socatArgs = ["-", `TCP:${this.chatEndpoint}`];
      console.log(`[SDK] Spawning socat: ${this.socatCommand} ${socatArgs.join(" ")}`);
      const spawnOptions = {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        // Only use detached on non-Windows platforms
        detached: process.platform !== "win32"
      };
      this.process = spawn(this.socatCommand, socatArgs, spawnOptions);
      console.log(`[SDK] Socat spawned with PID: ${this.process.pid}`);
      if (this.process.stdout) {
        this.stdoutReader = createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity
        });
      }
      let stderrBuffer = [];
      if (this.process.stderr) {
        const stderrReader = createInterface({
          input: this.process.stderr,
          crlfDelay: Infinity
        });
        stderrReader.on("line", (line) => {
          stderrBuffer.push(line);
          if (stderrBuffer.length > 50) {
            stderrBuffer.shift();
          }
          if (this.options.stderr) {
            this.options.stderr(line);
          }
        });
      }
      this.process.on("error", (err) => {
        console.error(`[SDK] Socat error event:`, err);
        console.error(`[SDK] Error code: ${err.code}`);
        if (stderrBuffer.length > 0) {
          console.error(`[SDK] Stderr output before error:
${stderrBuffer.join("\n")}`);
        }
        this.exitError = new CLIConnectionError(`Failed to connect via socat: ${err.message}`);
        this.ready = false;
      });
      this.process.on("exit", (code, signal) => {
        console.log(`[SDK] Socat exited with code: ${code}, signal: ${signal}`);
        if (code !== null && code !== 0) {
          console.error(`[SDK] Socat failed with exit code: ${code}`);
          if (stderrBuffer.length > 0) {
            console.error(`[SDK] Stderr output:
${stderrBuffer.join("\n")}`);
          }
          this.exitError = new ProcessError("Socat connection failed", code);
        }
        this.ready = false;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const initContext = {
        type: "init"
      };
      if (this.options.additionalDirectories) {
        initContext.additionalDirectories = this.options.additionalDirectories;
      }
      if (this.options.model) {
        initContext.model = this.options.model;
      }
      if (this.options.resume) {
        initContext.resume = this.options.resume;
      }
      if (this.options.cwd) {
        initContext.cwd = this.options.cwd;
      }
      if (this.options.mcpServers) {
        const serversForRemote = {};
        for (const [name, config] of Object.entries(this.options.mcpServers)) {
          if ("type" in config && config.type === "sdk") {
            const sdkConfig = config;
            serversForRemote[name] = {
              type: sdkConfig.type,
              name: sdkConfig.name
            };
          } else {
            serversForRemote[name] = config;
          }
        }
        if (Object.keys(serversForRemote).length > 0) {
          initContext.mcpServers = serversForRemote;
        }
      }
      console.log(`[SDK] Sending init context:`, JSON.stringify(initContext));
      if (this.process.stdin) {
        await new Promise((resolve, reject) => {
          const line = "CHAT\n" + JSON.stringify(initContext) + "\n";
          this.process.stdin.write(line, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      this.ready = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[SDK] Failed to spawn socat:`, error);
      throw new CLIConnectionError(`Failed to connect via socat: ${error.message}`);
    }
  }
  async write(data) {
    if (this.writeLock) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return this.write(data);
    }
    this.writeLock = true;
    try {
      if (!this.ready || !this.process?.stdin) {
        throw new CLIConnectionError("SocatTransport is not ready for writing");
      }
      if (this.exitError) {
        throw new CLIConnectionError(
          `Cannot write to process that exited with error: ${this.exitError.message}`
        );
      }
      await new Promise((resolve, reject) => {
        this.process.stdin.write(data, (err) => {
          if (err) {
            this.ready = false;
            this.exitError = new CLIConnectionError(
              `Failed to write to socat stdin: ${err.message}`
            );
            reject(this.exitError);
          } else {
            resolve();
          }
        });
      });
    } finally {
      this.writeLock = false;
    }
  }
  async *readMessages() {
    if (!this.process || !this.stdoutReader) {
      throw new CLIConnectionError("Not connected");
    }
    let jsonBuffer = "";
    try {
      for await (const line of this.stdoutReader) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        jsonBuffer += trimmedLine;
        if (jsonBuffer.length > this.maxBufferSize) {
          const bufferLength = jsonBuffer.length;
          jsonBuffer = "";
          throw new CLIJSONDecodeError(
            `JSON message exceeded maximum buffer size of ${this.maxBufferSize} bytes`,
            new Error(`Buffer size ${bufferLength} exceeds limit ${this.maxBufferSize}`)
          );
        }
        try {
          const data = JSON.parse(jsonBuffer);
          jsonBuffer = "";
          yield data;
        } catch {
          continue;
        }
      }
    } catch (err) {
      if (err instanceof CLIJSONDecodeError) {
        throw err;
      }
    }
    if (this.process.exitCode !== null && this.process.exitCode !== 0) {
      throw new ProcessError(
        "Socat connection failed",
        this.process.exitCode,
        "Check stderr output for details"
      );
    }
  }
  async close() {
    if (!this.process) {
      this.ready = false;
      return;
    }
    this.ready = false;
    if (this.process.stdin) {
      try {
        this.process.stdin.end();
      } catch {
      }
    }
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }
    if (this.process.exitCode === null) {
      this.process.kill("SIGTERM");
    }
    this.process = null;
    this.exitError = null;
  }
  async endInput() {
    if (this.process?.stdin) {
      try {
        this.process.stdin.end();
      } catch {
      }
    }
  }
  isReady() {
    return this.ready;
  }
  async queryPrepare(messages) {
    const additionalPaths = [];
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg && typeof msg === "object" && "message" in msg) {
          const sdkMsg = msg;
          if (sdkMsg.message?.content && Array.isArray(sdkMsg.message.content)) {
            for (const content of sdkMsg.message.content) {
              if (content && typeof content === "object" && "type" in content) {
                if (content.type === "additional_folder") {
                  const folderContent = content;
                  if (folderContent.paths && Array.isArray(folderContent.paths)) {
                    additionalPaths.push(...folderContent.paths);
                  }
                }
              }
            }
          }
        }
      }
    }
    if (additionalPaths.length === 0) {
      console.debug("[SDK] queryPrepare: no additional directories to mount");
      return;
    }
    const mountData = {
      additionalDirectories: additionalPaths,
      cwd: this.options.cwd
    };
    console.log(`[SDK] Sending MOUNT command:`, JSON.stringify(mountData));
    let mountProcess = null;
    try {
      const socatArgs = ["-", `TCP:${this.chatEndpoint}`];
      console.log(`[SDK] Spawning socat for MOUNT: ${this.socatCommand} ${socatArgs.join(" ")}`);
      const spawnOptions = {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32"
      };
      mountProcess = spawn(this.socatCommand, socatArgs, spawnOptions);
      console.log(`[SDK] MOUNT socat spawned with PID: ${mountProcess.pid}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (mountProcess.stdin) {
        await new Promise((resolve, reject) => {
          const line = "MOUNT\n" + JSON.stringify(mountData) + "\n";
          mountProcess.stdin.write(line, (err) => {
            if (err) {
              console.error(`[SDK] Failed to write MOUNT command:`, err);
              reject(new CLIConnectionError(`Failed to send MOUNT command: ${err.message}`));
            } else {
              console.log(`[SDK] MOUNT command sent successfully`);
              resolve();
            }
          });
        });
        mountProcess.stdin.end();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[SDK] Failed to send MOUNT command:`, error);
      throw new CLIConnectionError(`Failed to send MOUNT command: ${error.message}`);
    } finally {
      if (mountProcess) {
        try {
          if (mountProcess.exitCode === null) {
            mountProcess.kill("SIGTERM");
          }
        } catch (err) {
          console.error(`[SDK] Error killing MOUNT process:`, err);
        }
      }
    }
  }
  /**
   * Get account ID from options or generate from cwd
   */
  getAccountId() {
    if (!this.options.cwd) {
      throw new CLIConnectionError(
        "cwd is required in options for socat transport"
      );
    }
    return this.options.sessionId || this.generateSessionId(this.options.cwd);
  }
  /**
   * Generate sessionId from cwd using SHA-256 hash
   */
  generateSessionId(cwd) {
    const hash = createHash("sha256").update(cwd).digest("hex");
    return hash.substring(0, 32);
  }
};

// src/client.ts
var QoderAgentSDKClient = class {
  options;
  customTransport;
  transport = null;
  queryHandler = null;
  constructor(options, transport) {
    this.options = options ?? {};
    this.customTransport = transport;
    process.env.QODER_ENTRYPOINT = "sdk-ts-client";
  }
  /**
   * Connect to Qoder with an optional prompt or message stream.
   */
  async connect(prompt) {
    async function* emptyStream() {
      return;
    }
    const actualPrompt = prompt ?? emptyStream();
    let finalPrompt = typeof actualPrompt === "string" ? emptyStream() : actualPrompt;
    let configuredOptions = { ...this.options };
    if (this.options.canUseTool) {
      if (this.options.permissionPromptToolName) {
        throw new Error(
          "canUseTool callback cannot be used with permissionPromptToolName. Please use one or the other."
        );
      }
      if (typeof prompt === "string") {
        const stringPrompt = prompt;
        async function* stringToAsyncIterable() {
          yield {
            type: "user",
            session_id: "default",
            message: { role: "user", content: [{ type: "text", text: stringPrompt }] },
            parent_tool_use_id: null
          };
        }
        finalPrompt = stringToAsyncIterable();
      }
      configuredOptions = { ...configuredOptions, permissionPromptToolName: "stdio" };
    }
    this.transport = this.customTransport ?? new SubprocessTransport({
      prompt: finalPrompt,
      options: configuredOptions
    });
    await this.transport.connect();
    const sdkMcpServers = {};
    if (configuredOptions.mcpServers) {
      for (const [name, config] of Object.entries(configuredOptions.mcpServers)) {
        if ("type" in config && config.type === "sdk" && "instance" in config) {
          sdkMcpServers[name] = config.instance;
        }
      }
    }
    const initializeTimeoutMs = parseInt(
      process.env.QODER_STREAM_CLOSE_TIMEOUT ?? "60000",
      10
    );
    const initializeTimeout = Math.max(initializeTimeoutMs / 1e3, 60);
    this.queryHandler = new QueryHandler({
      transport: this.transport,
      isStreamingMode: true,
      // Client always uses streaming mode
      canUseTool: configuredOptions.canUseTool,
      hooks: configuredOptions.hooks,
      sdkMcpServers,
      initializeTimeout
    });
    await this.queryHandler.start();
    await this.queryHandler.initialize();
    const shouldStreamInput = prompt !== void 0 && (typeof prompt !== "string" || this.options.canUseTool);
    if (shouldStreamInput) {
      this.queryHandler.streamInput(finalPrompt).catch(() => {
      });
    }
  }
  /**
   * Receive all messages from Qoder.
   */
  async *receiveMessages() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    for await (const message of this.queryHandler.receiveMessages()) {
      yield message;
    }
  }
  /**
   * Send a new query in streaming mode.
   */
  async query(prompt, sessionId = "default") {
    if (!this.queryHandler || !this.transport) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    if (typeof prompt === "string") {
      const message = {
        type: "user",
        session_id: sessionId,
        message: { role: "user", content: [{ type: "text", text: prompt }] },
        parent_tool_use_id: null
      };
      await this.transport.queryPrepare([message]);
      await this.transport.write(JSON.stringify(message) + "\n");
    } else {
      const messages = [];
      for await (const msg of prompt) {
        const messageWithSession = {
          ...msg,
          session_id: msg.session_id ?? sessionId
        };
        messages.push(messageWithSession);
      }
      await this.transport.queryPrepare(messages);
      for (const msg of messages) {
        await this.transport.write(JSON.stringify(msg) + "\n");
      }
    }
  }
  /**
   * Send interrupt signal (only works with streaming mode).
   */
  async interrupt() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    await this.queryHandler.interrupt();
  }
  /**
   * Change permission mode during conversation.
   */
  async setPermissionMode(mode) {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    await this.queryHandler.setPermissionMode(mode);
  }
  /**
   * Change the AI model during conversation.
   */
  async setModel(model) {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    await this.queryHandler.setModel(model);
  }
  /**
   * Rewind tracked files to their state at a specific user message.
   */
  async rewindFiles(userMessageId) {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    await this.queryHandler.rewindFiles(userMessageId);
  }
  /**
   * Perform login using the current connection.
   *
   * Sends a login control request to the CLI, which opens a browser
   * for authentication and waits for the login flow to complete.
   *
   * @returns LoginResult with success status and username
   *
   * @example
   * ```typescript
   * const client = new QoderAgentSDKClient();
   * await client.connect();
   *
   * const result = await client.login();
   * if (result.success) {
   *   console.log(`Logged in as ${result.username}`);
   * }
   * ```
   */
  async login() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    const response = await this.queryHandler.sendAccountOperation("login");
    if (!response.success) {
      return {
        success: false,
        message: response.error ?? "Login failed"
      };
    }
    const data = response.data;
    return {
      success: true,
      message: data?.already_logged_in ? "Already logged in" : data?.message ?? "Login successful",
      username: data?.username
    };
  }
  /**
   * Logout from Qoder account using the current connection.
   *
   * Clears the current user's authentication credentials.
   *
   * @returns LogoutResult with success status
   *
   * @example
   * ```typescript
   * const result = await client.logout();
   * if (result.success) {
   *   console.log('Logged out successfully');
   * }
   * ```
   */
  async logout() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    const response = await this.queryHandler.sendAccountOperation("logout");
    if (!response.success) {
      return {
        success: false,
        message: response.error ?? "Logout failed"
      };
    }
    const data = response.data;
    return {
      success: true,
      message: data?.message ?? "Logout successful"
    };
  }
  /**
   * Get current user status using the current connection.
   *
   * Retrieves login status and account information.
   *
   * @returns StatusInfo with user details
   *
   * @example
   * ```typescript
   * const status = await client.getStatus();
   * if (status.loggedIn) {
   *   console.log(`Logged in as ${status.username}`);
   * }
   * ```
   */
  async getStatus() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    const defaultStatus = {
      loggedIn: false,
      username: "",
      email: "",
      avatarUrl: "",
      userType: "",
      plan: "",
      version: ""
    };
    try {
      const response = await this.queryHandler.sendAccountOperation("status");
      if (!response.success) {
        return defaultStatus;
      }
      const data = response.data;
      return {
        loggedIn: data?.logged_in ?? false,
        username: data?.username ?? "",
        email: data?.email ?? "",
        avatarUrl: data?.avatar_url ?? "",
        userType: data?.user_type ?? "",
        plan: data?.plan ?? "",
        version: data?.version ?? ""
      };
    } catch {
      return defaultStatus;
    }
  }
  /**
   * Submit feedback for a session using the current connection.
   *
   * @param content - Feedback content
   * @param sessionId - Session ID
   * @param workdir - Working directory
   * @param include - Additional files to include
   * @returns FeedbackResult with success status
   *
   * @example
   * ```typescript
   * const result = await client.feedback(
   *   'Great experience!',
   *   'session-abc123',
   *   '/path/to/project',
   *   []
   * );
   * ```
   */
  async feedback(content, sessionId, workdir, include) {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    const response = await this.queryHandler.sendAccountOperation("feedback", {
      content,
      session_id: sessionId,
      workdir,
      include
    });
    if (!response.success) {
      return {
        success: false,
        message: response.error ?? "Feedback submission failed"
      };
    }
    const data = response.data;
    return {
      success: true,
      message: data?.message ?? "Feedback submitted successfully"
    };
  }
  /**
   * Check Qoder Work access using the current connection.
   * @returns QoderWorkAccessResult with invited status
   */
  async checkQoderWorkAccess() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    try {
      const response = await this.queryHandler.sendAccountOperation("qoder_work_check");
      if (!response.success) {
        return { invited: false };
      }
      const data = response.data;
      return {
        invited: data?.invited ?? false
      };
    } catch {
      return { invited: false };
    }
  }
  /**
   * Get account usage information using the current connection.
   *
   * @returns UsageInfo with detailed usage and quota information
   *
   * @example
   * ```typescript
   * const usage = await client.getUsage();
   * console.log(`Usage: ${usage.totalUsagePercentage}%`);
   * console.log(`Quota: $${usage.userQuota.used} / $${usage.userQuota.total}`);
   * ```
   */
  async getUsage() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    try {
      const response = await this.queryHandler.sendAccountOperation("usage");
      if (!response.success) {
        throw new Error(response.error ?? "Failed to get usage information");
      }
      const data = response.data;
      if (!data) {
        throw new Error("No usage data returned from CLI");
      }
      return {
        userId: data.userId ?? "",
        userType: data.userType ?? "",
        totalUsagePercentage: data.totalUsagePercentage ?? 0,
        isHighestTier: data.isHighestTier ?? false,
        expiresAt: data.expiresAt ?? 0,
        upgradeUrl: data.upgradeUrl ?? "",
        userQuota: {
          total: data.userQuota?.total ?? 0,
          used: data.userQuota?.used ?? 0,
          remaining: data.userQuota?.remaining ?? 0,
          percentage: data.userQuota?.percentage ?? 0,
          unit: data.userQuota?.unit ?? ""
        },
        addOnQuota: {
          total: data.addOnQuota?.total ?? 0,
          used: data.addOnQuota?.used ?? 0,
          remaining: data.addOnQuota?.remaining ?? 0,
          percentage: data.addOnQuota?.percentage ?? 0,
          unit: data.addOnQuota?.unit ?? "",
          detailUrl: data.addOnQuota?.detailUrl ?? ""
        },
        isQuotaExceeded: data.isQuotaExceeded ?? false,
        orgResourcePackage: {
          used: data.orgResourcePackage?.used ?? 0
        }
      };
    } catch (err) {
      throw err instanceof CLIConnectionError ? err : new Error(
        err instanceof Error ? err.message : "Failed to get usage information"
      );
    }
  }
  /**
   * Get server initialization info.
   */
  async getServerInfo() {
    if (!this.queryHandler) {
      throw new CLIConnectionError("Not connected. Call connect() first.");
    }
    return this.queryHandler.getInitializationResult();
  }
  /**
   * Receive messages until and including a ResultMessage.
   */
  async *receiveResponse() {
    for await (const message of this.receiveMessages()) {
      yield message;
      if (message.type === "result") {
        return;
      }
    }
  }
  /**
   * Disconnect from Qoder.
   */
  async disconnect() {
    if (this.queryHandler) {
      await this.queryHandler.close();
      this.queryHandler = null;
    }
    this.transport = null;
  }
  /**
   * Async context manager support - enter.
   */
  async [Symbol.asyncDispose]() {
    await this.disconnect();
  }
};

// src/mcp.ts
function tool(name, description, inputSchema, handler) {
  return {
    name,
    description,
    inputSchema,
    handler
  };
}
function createSdkMcpServer(options) {
  const { name, version = "1.0.0", tools = [] } = options;
  const instance = {
    async connect() {
    },
    async close() {
    }
  };
  return {
    type: "sdk",
    name,
    instance
  };
}

// src/types/common.ts
var AbortError = class extends Error {
  constructor(message) {
    super(message ?? "Operation aborted");
    this.name = "AbortError";
  }
};

export { AbortError, CLIConnectionError, CLIJSONDecodeError, CLINotFoundError, ControlRequestTimeoutError, IntegrationMode, MessageParseError, ProcessError, QoderAgentSDKClient, QoderAgentSDKError, SocatTransport, SubprocessTransport, VERSION, configure, createSdkMcpServer, query, tool };
