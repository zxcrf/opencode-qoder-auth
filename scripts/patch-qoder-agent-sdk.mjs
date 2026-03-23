import { readFileSync, writeFileSync } from 'node:fs'

const filePath = new URL('../src/vendor/qoder-agent-sdk.mjs', import.meta.url)
let source = readFileSync(filePath, 'utf8')
const alreadyPatched = source.includes('buildPreparedPromptFromMessages')

const replacements = [
  {
    label: 'inject helper functions',
    find: `var ControlRequestTimeoutError = class extends QoderAgentSDKError {\n  subtype;\n  constructor(subtype) {\n    super(\`Control request timeout: \${subtype}\`);\n    this.name = "ControlRequestTimeoutError";\n    this.subtype = subtype;\n  }\n};\n\n// src/internal/subprocess-transport.ts\n`,
    replace: `var ControlRequestTimeoutError = class extends QoderAgentSDKError {\n  subtype;\n  constructor(subtype) {\n    super(\`Control request timeout: \${subtype}\`);\n    this.name = "ControlRequestTimeoutError";\n    this.subtype = subtype;\n  }\n};\n\nfunction buildPreparedPromptFromMessages(messages, createTempFile) {\n  const promptParts = [];\n  const attachments = [];\n  if (!Array.isArray(messages)) {\n    return {\n      promptText: "Please analyze the attached file(s).",\n      attachments\n    };\n  }\n  for (const msg of messages) {\n    if (!msg || typeof msg !== "object" || msg.type !== "user") {\n      continue;\n    }\n    const content = msg.message?.content;\n    if (!Array.isArray(content)) {\n      continue;\n    }\n    const textParts = [];\n    for (const block of content) {\n      if (!block || typeof block !== "object") {\n        continue;\n      }\n      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {\n        textParts.push(block.text);\n      } else if (block.type === "image") {\n        const source = block.source;\n        if (source?.type === "base64" && typeof source.data === "string" && source.data.length > 0) {\n          attachments.push(createTempFile(source.data, source.media_type));\n        }\n      }\n    }\n    if (textParts.length > 0) {\n      promptParts.push(textParts.join("\\n"));\n    }\n  }\n  return {\n    promptText: promptParts.join("\\n\\n").trim() || "Please analyze the attached file(s).",\n    attachments\n  };\n}\nfunction mediaTypeToExtension(mediaType) {\n  switch ((mediaType || "").toLowerCase()) {\n    case "image/png":\n      return ".png";\n    case "image/jpeg":\n    case "image/jpg":\n      return ".jpg";\n    case "image/webp":\n      return ".webp";\n    case "image/gif":\n      return ".gif";\n    case "application/pdf":\n      return ".pdf";\n    default:\n      return "";\n  }\n}\nasync function* replayMessages(messages) {\n  for (const message of messages) {\n    yield message;\n  }\n}\n\n// src/internal/subprocess-transport.ts\n`,
  },
  {
    label: 'inject subprocess fields',
    find: `  maxBufferSize;\n  tempFiles = [];\n  writeLock = false;\n  _disconnectPromise;\n  _disconnectReject;\n  constructor({ prompt, options }) {\n`,
    replace: `  maxBufferSize;\n  tempFiles = [];\n  writeLock = false;\n  _disconnectPromise;\n  _disconnectReject;\n  preparedPromptText = null;\n  preparedAttachments = [];\n  usePreparedNonStreaming = false;\n  constructor({ prompt, options }) {\n`,
  },
  {
    label: 'patch command builder',
    find: `    if (this.isStreaming) {\n      cmd.push("--input-format", "stream-json");\n    } else {\n      cmd.push("--print", String(this.prompt));\n    }\n`,
    replace: `    if (this.usePreparedNonStreaming) {\n      for (const attachment of this.preparedAttachments) {\n        cmd.push("--attachment", attachment);\n      }\n      cmd.push("--print", this.preparedPromptText ?? "Please analyze the attached file(s).");\n    } else if (this.isStreaming) {\n      cmd.push("--input-format", "stream-json");\n    } else {\n      cmd.push("--print", String(this.prompt));\n    }\n`,
  },
  {
    label: 'patch stdin close condition',
    find: `      if (!this.isStreaming && this.process.stdin) {\n        this.process.stdin.end();\n      }\n`,
    replace: `      if ((!this.isStreaming || this.usePreparedNonStreaming) && this.process.stdin) {\n        this.process.stdin.end();\n      }\n`,
  },
  {
    label: 'patch subprocess queryPrepare',
    find: `  isReady() {\n    return this.ready;\n  }\n  getDisconnectPromise() {\n    return this._disconnectPromise;\n  }\n  async queryPrepare(_messages) {\n  }\n};\n`,
    replace: `  isReady() {\n    return this.ready;\n  }\n  getDisconnectPromise() {\n    return this._disconnectPromise;\n  }\n  shouldUsePreparedNonStreamingMode() {\n    return this.usePreparedNonStreaming;\n  }\n  createTempAttachmentFile(base64Data, mediaType) {\n    const extension = mediaTypeToExtension(mediaType);\n    const hash = createHash("sha256").update(base64Data).digest("hex").slice(0, 12);\n    const filePath = path.join(\n      os.tmpdir(),\n      \`qoder-sdk-attachment-\${process.pid}-\${Date.now()}-\${hash}\${extension}\`\n    );\n    fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));\n    this.tempFiles.push(filePath);\n    return filePath;\n  }\n  async queryPrepare(messages) {\n    const prepared = buildPreparedPromptFromMessages(\n      messages,\n      (base64Data, mediaType) => this.createTempAttachmentFile(base64Data, mediaType)\n    );\n    if (prepared.attachments.length === 0) {\n      return;\n    }\n    this.preparedPromptText = prepared.promptText;\n    this.preparedAttachments = prepared.attachments;\n    this.usePreparedNonStreaming = true;\n  }\n};\n`,
  },
  {
    label: 'patch query runtime preparation',
    find: `  const transport = customTransport ?? new SubprocessTransport({\n    prompt: finalPrompt,\n    options: configuredOptions\n  });\n  const sdkMcpServers = {};\n  if (configuredOptions.mcpServers) {\n    for (const [name, config] of Object.entries(configuredOptions.mcpServers)) {\n      if ("type" in config && config.type === "sdk" && "instance" in config) {\n        sdkMcpServers[name] = config.instance;\n      }\n    }\n  }\n  const queryHandler = new QueryHandler({\n    transport,\n    isStreamingMode,\n    canUseTool: configuredOptions.canUseTool,\n    hooks: configuredOptions.hooks,\n    sdkMcpServers\n  });\n  let started = false;\n  async function* createGenerator() {\n    try {\n      await transport.connect();\n      await queryHandler.start();\n      if (isStreamingMode) {\n        await queryHandler.initialize();\n      }\n      if (isStreamingMode) {\n        queryHandler.streamInput(finalPrompt).catch(() => {\n        });\n      }\n`,
    replace: `  let transport = null;\n  let queryHandler = null;\n  let runtime = null;\n  async function prepareRuntime() {\n    if (runtime) {\n      return runtime;\n    }\n    let preparedPrompt = finalPrompt;\n    let effectiveStreamingMode = isStreamingMode;\n    let preparedMessages = null;\n    if (isStreamingMode) {\n      preparedMessages = [];\n      for await (const message of finalPrompt) {\n        preparedMessages.push(message);\n      }\n    }\n    preparedPrompt = preparedMessages ? replayMessages(preparedMessages) : finalPrompt;\n    transport = customTransport ?? new SubprocessTransport({\n      prompt: preparedPrompt,\n      options: configuredOptions\n    });\n    if (preparedMessages) {\n      await transport.queryPrepare(preparedMessages);\n      preparedPrompt = replayMessages(preparedMessages);\n      if (typeof transport.shouldUsePreparedNonStreamingMode === "function" && transport.shouldUsePreparedNonStreamingMode()) {\n        effectiveStreamingMode = false;\n      }\n    }\n    const sdkMcpServers = {};\n    if (configuredOptions.mcpServers) {\n      for (const [name, config] of Object.entries(configuredOptions.mcpServers)) {\n        if ("type" in config && config.type === "sdk" && "instance" in config) {\n          sdkMcpServers[name] = config.instance;\n        }\n      }\n    }\n    queryHandler = new QueryHandler({\n      transport,\n      isStreamingMode: effectiveStreamingMode,\n      canUseTool: configuredOptions.canUseTool,\n      hooks: configuredOptions.hooks,\n      sdkMcpServers\n    });\n    runtime = {\n      prompt: preparedPrompt,\n      isStreamingMode: effectiveStreamingMode\n    };\n    return runtime;\n  }\n  let started = false;\n  async function* createGenerator() {\n    try {\n      const preparedRuntime = await prepareRuntime();\n      await transport.connect();\n      await queryHandler.start();\n      if (preparedRuntime.isStreamingMode) {\n        await queryHandler.initialize();\n      }\n      if (preparedRuntime.isStreamingMode) {\n        queryHandler.streamInput(preparedRuntime.prompt).catch(() => {\n        });\n      }\n`,
  },
  {
    label: 'patch query methods',
    find: `    async interrupt() {\n      if (!isStreamingMode) {\n        throw new Error("interrupt() is only available in streaming mode");\n      }\n      await queryHandler.interrupt();\n    },\n`,
    replace: `    async interrupt() {\n      const preparedRuntime = await prepareRuntime();\n      if (!preparedRuntime.isStreamingMode) {\n        throw new Error("interrupt() is only available in streaming mode");\n      }\n      await queryHandler.interrupt();\n    },\n`,
  },
  {
    label: 'patch setPermissionMode',
    find: `    async setPermissionMode(mode) {\n      if (!isStreamingMode) {\n        throw new Error("setPermissionMode() is only available in streaming mode");\n      }\n      await queryHandler.setPermissionMode(mode);\n    },\n`,
    replace: `    async setPermissionMode(mode) {\n      const preparedRuntime = await prepareRuntime();\n      if (!preparedRuntime.isStreamingMode) {\n        throw new Error("setPermissionMode() is only available in streaming mode");\n      }\n      await queryHandler.setPermissionMode(mode);\n    },\n`,
  },
  {
    label: 'patch setModel',
    find: `    async setModel(model) {\n      if (!isStreamingMode) {\n        throw new Error("setModel() is only available in streaming mode");\n      }\n      await queryHandler.setModel(model);\n    },\n`,
    replace: `    async setModel(model) {\n      const preparedRuntime = await prepareRuntime();\n      if (!preparedRuntime.isStreamingMode) {\n        throw new Error("setModel() is only available in streaming mode");\n      }\n      await queryHandler.setModel(model);\n    },\n`,
  },
  {
    label: 'patch setMaxThinkingTokens',
    find: `    async setMaxThinkingTokens(maxThinkingTokens) {\n      if (!isStreamingMode) {\n        throw new Error("setMaxThinkingTokens() is only available in streaming mode");\n      }\n      await queryHandler.setMaxThinkingTokens(maxThinkingTokens);\n    },\n`,
    replace: `    async setMaxThinkingTokens(maxThinkingTokens) {\n      const preparedRuntime = await prepareRuntime();\n      if (!preparedRuntime.isStreamingMode) {\n        throw new Error("setMaxThinkingTokens() is only available in streaming mode");\n      }\n      await queryHandler.setMaxThinkingTokens(maxThinkingTokens);\n    },\n`,
  },
  {
    label: 'patch supportedCommands guard',
    find: `    async supportedCommands() {\n      const initResult = queryHandler.getInitializationResult();\n`,
    replace: `    async supportedCommands() {\n      if (!queryHandler) {\n        return [];\n      }\n      const initResult = queryHandler.getInitializationResult();\n`,
  },
  {
    label: 'patch supportedModels guard',
    find: `    async supportedModels() {\n      const initResult = queryHandler.getInitializationResult();\n`,
    replace: `    async supportedModels() {\n      if (!queryHandler) {\n        return [];\n      }\n      const initResult = queryHandler.getInitializationResult();\n`,
  },
  {
    label: 'patch mcpServerStatus guard',
    find: `    async mcpServerStatus() {\n      const initResult = queryHandler.getInitializationResult();\n`,
    replace: `    async mcpServerStatus() {\n      if (!queryHandler) {\n        return [];\n      }\n      const initResult = queryHandler.getInitializationResult();\n`,
  },
  {
    label: 'patch accountInfo guard',
    find: `    async accountInfo() {\n      const initResult = queryHandler.getInitializationResult();\n`,
    replace: `    async accountInfo() {\n      if (!queryHandler) {\n        return {};\n      }\n      const initResult = queryHandler.getInitializationResult();\n`,
  },
]

if (!alreadyPatched) {
  for (const replacement of replacements) {
    if (!source.includes(replacement.find)) {
      throw new Error(`Patch anchor not found: ${replacement.label}`)
    }
    source = source.replace(replacement.find, replacement.replace)
  }
}

source = source.replace(/\n\/\/# sourceMappingURL=index\.mjs\.map/g, '')

writeFileSync(filePath, source)
console.log(alreadyPatched ? 'qoder-agent-sdk.mjs already patched' : 'patched qoder-agent-sdk.mjs successfully')
