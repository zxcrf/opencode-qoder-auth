# AGENTS.md

This is **opencode-qoder-plugin** — an [opencode](https://opencode.ai) plugin that injects Qoder AI models via a `config` hook. No manual provider configuration needed by users.

## Project Structure

```
opencode-qoder-plugin/
├── index.ts                     # Plugin entry — config hook + auth hook
├── provider.ts                  # Exports createQoderProvider() (opencode npm loader entry)
├── src/
│   ├── models.ts                # 10 built-in model definitions (injected by config hook)
│   ├── qoder-language-model.ts  # LanguageModelV2 implementation (doGenerate + doStream)
│   ├── prompt-builder.ts        # AI SDK CallOptions → Qoder prompt / multimodal builder
│   └── vendor/
│       ├── qoder-agent-sdk.mjs  # Vendored Qoder Agent SDK — DO NOT modify
│       └── qoder-agent-sdk.d.ts # SDK type declarations — DO NOT modify
└── tests/
    ├── models.test.ts
    ├── plugin.test.ts
    ├── qoder-language-model.test.ts
    └── integration/
        ├── real-api.test.ts       # Requires `qoder login`
        └── opencode-cli.test.ts
```

## Key Design Decisions

- **Plugin, not provider config** — `index.ts` uses the `config` hook to inject `provider.qoder` automatically. Users only need `"plugin": ["opencode-qoder-plugin"]` in their `opencode.json`.
- **Auth hook** — checks `~/.qoder/.auth/user` for login state. If absent, surfaces a prompt telling users to run `qoder login`.
- **Vendored SDK** — `src/vendor/qoder-agent-sdk.mjs` is a bundled copy of `@ali/qoder-agent-sdk` (internal registry). Do not replace it without testing the full streaming pipeline.
- **Model merging** — builtin models from `src/models.ts` are injected first; any `provider.qoder.models` overrides in the user's `opencode.json` take precedence.

## How the Streaming Pipeline Works

```
opencode → QoderLanguageModel.doStream()
  → buildPromptFromOptions()   # text or multimodal (base64 image)
  → resolveQoderCLI()          # finds latest ~/.qoder/bin/qodercli/qodercli-<version>
  → SDK query()                # streams SDKMessage events
      ├─ stream_event path     # incremental text / tool-input deltas (preferred)
      └─ assistant path        # full-block fallback
  → ReadableStream<V2StreamPart>
```

## Development

```bash
npm install
npm test          # unit tests, no network required
```

## Release Process

Releases are automated via GitHub Actions:

1. Update `version` in `package.json`
2. Commit and push: `git commit -m "chore: release vX.Y.Z"`
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. The **Publish** workflow triggers automatically and publishes to npmjs.com using `NPM_TOKEN` secret

> **NPM_TOKEN** must be set in GitHub repo Settings → Secrets → `NPM_TOKEN`.  
> Use an **Automation** type token from https://www.npmjs.com/settings/~/tokens to bypass OTP.

## What NOT to Do

- Do not modify `src/vendor/` files without thorough integration testing
- Do not add a `provider.qoder` block to `opencode.json` — the plugin injects it automatically
- Do not move `@opencode-ai/plugin` back to `devDependencies` — it must be in `dependencies` so opencode's Bun installer pulls it
