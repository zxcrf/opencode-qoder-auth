import { ZodRawShape, z, ZodObject } from 'zod';

/**
 * SDK Version
 */
declare const VERSION: string;

/**
 * Global configuration for the SDK
 */
/**
 * Integration mode for the SDK.
 * Determines how the SDK integrates with the Qoder ecosystem.
 */
declare enum IntegrationMode {
    /** Integration with Qoder Work platform */
    QoderWork = "qoder_work",
    /** Integration with Quest platform */
    Quest = "quest"
}
/**
 * Global SDK configuration options
 */
interface SDKConfig {
    /** Custom storage directory for CLI data */
    storageDir?: string;
    /** Custom resource directory for CLI resources */
    resourceDir?: string;
    /** Integration mode for the SDK */
    integrationMode?: IntegrationMode;
}
/**
 * Configure global SDK settings.
 *
 * Call this once at application startup before using other SDK functions.
 * All subsequent SDK operations will use these settings.
 *
 * @param config - Configuration options
 *
 * @example
 * ```typescript
 * import { configure, query, login } from '@qoder-ai/qoder-agent-sdk';
 *
 * // Set global storage directory once
 * configure({
 *   storageDir: '/custom/path/to/storage',
 *   resourceDir: '/custom/path/to/resources'
 * });
 *
 * // All SDK operations will now use this storage directory
 * await login();
 * const result = query({ prompt: 'Hello' });
 * ```
 */
declare function configure(config: SDKConfig): void;

/**
 * SDK Logger Module
 *
 * Provides structured file-based logging with rotation support.
 */
/**
 * Log level enumeration
 */
declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
/**
 * Logger configuration options
 */
interface LoggerConfig {
    /** Enable or disable logging (default: true) */
    enabled?: boolean;
    /** Minimum log level to record (default: INFO) */
    level?: LogLevel;
    /** Directory for log files (default: ~/.qoder/logs/) */
    directory?: string;
    /** Log filename (default: qoder-agent-sdk-typescript.log) */
    filename?: string;
    /** Maximum file size in bytes before rotation (default: 10MB) */
    maxSize?: number;
    /** Number of days to retain rotated logs (default: 7) */
    retentionDays?: number;
}
/**
 * Logger interface
 */
interface ILogger {
    Debug(message: string, context?: string, meta?: Record<string, unknown>): void;
    Info(message: string, context?: string, meta?: Record<string, unknown>): void;
    Warn(message: string, context?: string, meta?: Record<string, unknown>): void;
    Error(message: string, context?: string, meta?: Record<string, unknown>): void;
    flush(): Promise<void>;
}
/**
 * Configure the SDK logger
 *
 * @example
 * ```typescript
 * import { configureLogger, LogLevel } from '@ali/qoder-agent-sdk';
 *
 * configureLogger({
 *   level: LogLevel.DEBUG,
 *   directory: '/var/log/myapp',
 *   maxSize: 20 * 1024 * 1024, // 20MB
 * });
 * ```
 */
declare function configureLogger(config: LoggerConfig): void;
/**
 * SDK Logger instance
 *
 * Provides structured logging with automatic file rotation.
 * Logs are written to ~/.qoder/logs/qoder-agent-sdk-typescript.log by default.
 *
 * @example
 * ```typescript
 * import { logger } from '@ali/qoder-agent-sdk';
 *
 * logger.Info('Operation started', 'MyModule');
 * logger.Debug('Debug info', 'MyModule', { requestId: '123' });
 * logger.Error('Something failed', 'MyModule', { error: 'timeout' });
 * ```
 */
declare const logger: ILogger;

/**
 * Common types used across the SDK
 */
/** UUID type alias */
type UUID = string;
/** Dictionary type */
type Dict<T> = Record<string, T>;
/** API Key source */
type ApiKeySource = 'user' | 'project' | 'org' | 'temporary';
/** Configuration scope */
type ConfigScope = 'local' | 'user' | 'project';
/** Available beta features */
type SdkBeta = 'context-1m-2025-08-07';
/** Permission mode for the session */
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
/** Permission behavior */
type PermissionBehavior = 'allow' | 'deny' | 'ask';
/** Permission update destination */
type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session';
/** Permission rule value */
interface PermissionRuleValue {
    toolName: string;
    ruleContent?: string;
}
/** Permission update operations */
type PermissionUpdate = {
    type: 'addRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'replaceRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'removeRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'setMode';
    mode: PermissionMode;
    destination: PermissionUpdateDestination;
} | {
    type: 'addDirectories';
    directories: string[];
    destination: PermissionUpdateDestination;
} | {
    type: 'removeDirectories';
    directories: string[];
    destination: PermissionUpdateDestination;
};
/** Token usage statistics */
interface Usage {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
}
/** Non-nullable version of Usage */
type NonNullableUsage = {
    [K in keyof Usage]: NonNullable<Usage[K]>;
};
/** Per-model usage statistics */
interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
}
/** Slash command information */
interface SlashCommand {
    name: string;
    description: string;
    argumentHint: string;
}
/** Model information */
interface ModelInfo {
    value: string;
    displayName: string;
    description: string;
}
/** MCP server status */
interface McpServerStatus {
    name: string;
    status: 'connected' | 'failed' | 'needs-auth' | 'pending';
    serverInfo?: {
        name: string;
        version: string;
    };
}
/** Account information */
interface AccountInfo {
    email?: string;
    organization?: string;
    subscriptionType?: string;
    tokenSource?: string;
    apiKeySource?: string;
}
/** Custom error class for abort operations */
declare class AbortError extends Error {
    constructor(message?: string);
}
/** Setting source for filesystem configuration */
type SettingSource = 'user' | 'project' | 'local';
/** JSON Schema type for structured outputs */
interface JSONSchema {
    type?: string;
    properties?: Record<string, JSONSchema>;
    required?: string[];
    items?: JSONSchema;
    additionalProperties?: boolean | JSONSchema;
    enum?: unknown[];
    const?: unknown;
    $ref?: string;
    definitions?: Record<string, JSONSchema>;
    [key: string]: unknown;
}

/**
 * Tool input and output types
 */
/** Agent/Task tool input */
interface AgentInput {
    /** A short (3-5 word) description of the task */
    description: string;
    /** The task for the agent to perform */
    prompt: string;
    /** The type of specialized agent to use for this task */
    subagent_type: string;
}
/** AskUserQuestion tool input */
interface AskUserQuestionInput {
    /** Questions to ask the user (1-4 questions) */
    questions: Array<{
        /** The complete question to ask the user */
        question: string;
        /** Very short label displayed as a chip/tag (max 12 chars) */
        header: string;
        /** The available choices (2-4 options) */
        options: Array<{
            /** Display text for this option (1-5 words) */
            label: string;
            /** Explanation of what this option means */
            description: string;
        }>;
        /** Set to true to allow multiple selections */
        multiSelect: boolean;
    }>;
    /** User answers populated by the permission system */
    answers?: Record<string, string>;
}
/** Bash tool input */
interface BashInput {
    /** The command to execute */
    command: string;
    /** Optional timeout in milliseconds (max 600000) */
    timeout?: number;
    /** Clear, concise description of what this command does in 5-10 words */
    description?: string;
    /** Set to true to run this command in the background */
    run_in_background?: boolean;
    /** Bypass sandbox (requires allowUnsandboxedCommands) */
    dangerouslyDisableSandbox?: boolean;
}
/** BashOutput tool input */
interface BashOutputInput {
    /** The ID of the background shell to retrieve output from */
    bash_id: string;
    /** Optional regex to filter output lines */
    filter?: string;
}
/** File Edit tool input */
interface FileEditInput {
    /** The absolute path to the file to modify */
    file_path: string;
    /** The text to replace */
    old_string: string;
    /** The text to replace it with (must be different from old_string) */
    new_string: string;
    /** Replace all occurrences of old_string (default false) */
    replace_all?: boolean;
}
/** File Read tool input */
interface FileReadInput {
    /** The absolute path to the file to read */
    file_path: string;
    /** The line number to start reading from */
    offset?: number;
    /** The number of lines to read */
    limit?: number;
}
/** File Write tool input */
interface FileWriteInput {
    /** The absolute path to the file to write */
    file_path: string;
    /** The content to write to the file */
    content: string;
}
/** Glob tool input */
interface GlobInput {
    /** The glob pattern to match files against */
    pattern: string;
    /** The directory to search in (defaults to cwd) */
    path?: string;
}
/** Grep tool input */
interface GrepInput {
    /** The regular expression pattern to search for */
    pattern: string;
    /** File or directory to search in (defaults to cwd) */
    path?: string;
    /** Glob pattern to filter files (e.g. "*.js") */
    glob?: string;
    /** File type to search (e.g. "js", "py", "rust") */
    type?: string;
    /** Output mode */
    output_mode?: 'content' | 'files_with_matches' | 'count';
    /** Case insensitive search */
    '-i'?: boolean;
    /** Show line numbers (for content mode) */
    '-n'?: boolean;
    /** Lines to show before each match */
    '-B'?: number;
    /** Lines to show after each match */
    '-A'?: number;
    /** Lines to show before and after each match */
    '-C'?: number;
    /** Limit output to first N lines/entries */
    head_limit?: number;
    /** Enable multiline mode */
    multiline?: boolean;
}
/** KillBash tool input */
interface KillShellInput {
    /** The ID of the background shell to kill */
    shell_id: string;
}
/** NotebookEdit tool input */
interface NotebookEditInput {
    /** The absolute path to the Jupyter notebook file */
    notebook_path: string;
    /** The ID of the cell to edit */
    cell_id?: string;
    /** The new source for the cell */
    new_source: string;
    /** The type of the cell (code or markdown) */
    cell_type?: 'code' | 'markdown';
    /** The type of edit (replace, insert, delete) */
    edit_mode?: 'replace' | 'insert' | 'delete';
}
/** WebFetch tool input */
interface WebFetchInput {
    /** The URL to fetch content from */
    url: string;
    /** The prompt to run on the fetched content */
    prompt: string;
}
/** WebSearch tool input */
interface WebSearchInput {
    /** The search query to use */
    query: string;
    /** Only include results from these domains */
    allowed_domains?: string[];
    /** Never include results from these domains */
    blocked_domains?: string[];
}
/** TodoWrite tool input */
interface TodoWriteInput {
    /** The updated todo list */
    todos: Array<{
        /** The task description */
        content: string;
        /** The task status */
        status: 'pending' | 'in_progress' | 'completed';
        /** Active form of the task description */
        activeForm: string;
    }>;
}
/** ExitPlanMode tool input */
interface ExitPlanModeInput {
    /** The plan to run by the user for approval */
    plan: string;
}
/** ListMcpResources tool input */
interface ListMcpResourcesInput {
    /** Optional server name to filter resources by */
    server?: string;
}
/** ReadMcpResource tool input */
interface ReadMcpResourceInput {
    /** The MCP server name */
    server: string;
    /** The resource URI to read */
    uri: string;
}
/** Union of all tool input types */
type ToolInput = AgentInput | AskUserQuestionInput | BashInput | BashOutputInput | FileEditInput | FileReadInput | FileWriteInput | GlobInput | GrepInput | KillShellInput | NotebookEditInput | WebFetchInput | WebSearchInput | TodoWriteInput | ExitPlanModeInput | ListMcpResourcesInput | ReadMcpResourceInput;
/** Task/Agent tool output */
interface TaskOutput {
    /** Final result message from the subagent */
    result: string;
    /** Token usage statistics */
    usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
    /** Total cost in USD */
    total_cost_usd?: number;
    /** Execution duration in milliseconds */
    duration_ms?: number;
}
/** AskUserQuestion tool output */
interface AskUserQuestionOutput {
    /** The questions that were asked */
    questions: Array<{
        question: string;
        header: string;
        options: Array<{
            label: string;
            description: string;
        }>;
        multiSelect: boolean;
    }>;
    /** The answers provided by the user */
    answers: Record<string, string>;
}
/** Bash tool output */
interface BashToolOutput {
    /** Combined stdout and stderr output */
    output: string;
    /** Exit code of the command */
    exitCode: number;
    /** Whether the command was killed due to timeout */
    killed?: boolean;
    /** Shell ID for background processes */
    shellId?: string;
}
/** BashOutput tool output */
interface BashOutputToolOutput {
    /** New output since last check */
    output: string;
    /** Current shell status */
    status: 'running' | 'completed' | 'failed';
    /** Exit code (when completed) */
    exitCode?: number;
}
/** Edit tool output */
interface EditOutput {
    /** Confirmation message */
    message: string;
    /** Number of replacements made */
    replacements: number;
    /** File path that was edited */
    file_path: string;
}
/** Text file read output */
interface TextFileOutput {
    /** File contents with line numbers */
    content: string;
    /** Total number of lines in file */
    total_lines: number;
    /** Lines actually returned */
    lines_returned: number;
}
/** Image file read output */
interface ImageFileOutput {
    /** Base64 encoded image data */
    image: string;
    /** Image MIME type */
    mime_type: string;
    /** File size in bytes */
    file_size: number;
}
/** PDF file read output */
interface PDFFileOutput {
    /** Array of page contents */
    pages: Array<{
        page_number: number;
        text?: string;
        images?: Array<{
            image: string;
            mime_type: string;
        }>;
    }>;
    /** Total number of pages */
    total_pages: number;
}
/** Notebook file read output */
interface NotebookFileOutput {
    /** Jupyter notebook cells */
    cells: Array<{
        cell_type: 'code' | 'markdown';
        source: string;
        outputs?: unknown[];
        execution_count?: number;
    }>;
    /** Notebook metadata */
    metadata?: Record<string, unknown>;
}
/** Read tool output */
type ReadOutput = TextFileOutput | ImageFileOutput | PDFFileOutput | NotebookFileOutput;
/** Write tool output */
interface WriteOutput {
    /** Success message */
    message: string;
    /** Number of bytes written */
    bytes_written: number;
    /** File path that was written */
    file_path: string;
}
/** Glob tool output */
interface GlobOutput {
    /** Array of matching file paths */
    matches: string[];
    /** Number of matches found */
    count: number;
    /** Search directory used */
    search_path: string;
}
/** Grep content output */
interface GrepContentOutput {
    /** Matching lines with context */
    matches: Array<{
        file: string;
        line_number?: number;
        line: string;
        before_context?: string[];
        after_context?: string[];
    }>;
    /** Total number of matches */
    total_matches: number;
}
/** Grep files output */
interface GrepFilesOutput {
    /** Files containing matches */
    files: string[];
    /** Number of files with matches */
    count: number;
}
/** Grep count output */
interface GrepCountOutput {
    /** Match counts per file */
    counts: Array<{
        file: string;
        count: number;
    }>;
    /** Total matches across all files */
    total: number;
}
/** Grep tool output */
type GrepOutput = GrepContentOutput | GrepFilesOutput | GrepCountOutput;
/** KillBash tool output */
interface KillBashOutput {
    /** Success message */
    message: string;
    /** ID of the killed shell */
    shell_id: string;
}
/** NotebookEdit tool output */
interface NotebookEditOutput {
    /** Success message */
    message: string;
    /** Type of edit performed */
    edit_type: 'replaced' | 'inserted' | 'deleted';
    /** Cell ID that was affected */
    cell_id?: string;
    /** Total cells in notebook after edit */
    total_cells: number;
}
/** WebFetch tool output */
interface WebFetchOutput {
    /** AI model's response to the prompt */
    response: string;
    /** URL that was fetched */
    url: string;
    /** Final URL after redirects */
    final_url?: string;
    /** HTTP status code */
    status_code?: number;
}
/** WebSearch tool output */
interface WebSearchOutput {
    /** Search results */
    results: Array<{
        title: string;
        url: string;
        snippet: string;
        /** Additional metadata if available */
        metadata?: Record<string, unknown>;
    }>;
    /** Total number of results */
    total_results: number;
    /** The query that was searched */
    query: string;
}
/** TodoWrite tool output */
interface TodoWriteOutput {
    /** Success message */
    message: string;
    /** Current todo statistics */
    stats: {
        total: number;
        pending: number;
        in_progress: number;
        completed: number;
    };
}
/** ExitPlanMode tool output */
interface ExitPlanModeOutput {
    /** Confirmation message */
    message: string;
    /** Whether user approved the plan */
    approved?: boolean;
}
/** ListMcpResources tool output */
interface ListMcpResourcesOutput {
    /** Available resources */
    resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
        server: string;
    }>;
    /** Total number of resources */
    total: number;
}
/** ReadMcpResource tool output */
interface ReadMcpResourceOutput {
    /** Resource contents */
    contents: Array<{
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
    }>;
    /** Server that provided the resource */
    server: string;
}
/** Union of all tool output types */
type ToolOutput = TaskOutput | AskUserQuestionOutput | BashToolOutput | BashOutputToolOutput | EditOutput | ReadOutput | WriteOutput | GlobOutput | GrepOutput | KillBashOutput | NotebookEditOutput | WebFetchOutput | WebSearchOutput | TodoWriteOutput | ExitPlanModeOutput | ListMcpResourcesOutput | ReadMcpResourceOutput;

/**
 * Message types for SDK communication
 */

/** API Assistant Message (from Anthropic SDK) */
interface APIAssistantMessage {
    role: 'assistant';
    content: AssistantMessageContent[];
}
/** Assistant message content types */
type AssistantMessageContent = TextContent | ToolUseContent | ThinkingContent;
/** Text content block */
interface TextContent {
    type: 'text';
    text: string;
}
/** Tool use content block */
interface ToolUseContent {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}
/** Thinking content block */
interface ThinkingContent {
    type: 'thinking';
    thinking: string;
}
/** API User Message (from Anthropic SDK) */
interface APIUserMessage {
    role: 'user';
    content: UserMessageContent[];
}
/** User message content types */
type UserMessageContent = TextContent | ImageContent | ToolResultContent | AdditionalFolderContent;
/** Additional folder content block for specifying extra directories */
interface AdditionalFolderContent {
    type: 'additional_folder';
    /** Paths to the additional folders */
    paths: string[];
}
/** Image content block */
interface ImageContent {
    type: 'image';
    source: {
        type: 'base64';
        media_type: string;
        data: string;
    };
}
/** Tool result content block */
interface ToolResultContent {
    type: 'tool_result';
    tool_use_id: string;
    content: string | unknown[];
    is_error?: boolean;
}
/** Raw message stream event (from Anthropic SDK) */
interface RawMessageStreamEvent {
    type: string;
    index?: number;
    delta?: {
        type?: string;
        text?: string;
        partial_json?: string;
        thinking?: string;
    };
    content_block?: {
        type: string;
        id?: string;
        name?: string;
        text?: string;
        thinking?: string;
    };
}
/** Permission denial information */
interface SDKPermissionDenial {
    tool_name: string;
    tool_use_id: string;
    tool_input: ToolInput;
}
/** Assistant response message */
interface SDKAssistantMessage {
    type: 'assistant';
    uuid: UUID;
    session_id: string;
    message: APIAssistantMessage;
    parent_tool_use_id: string | null;
}
/** User input message */
interface SDKUserMessage {
    type: 'user';
    uuid?: UUID;
    session_id: string;
    /** Optional request set ID for tracking/tracing; overrides the CLI's auto-generated value */
    request_id?: string;
    message: APIUserMessage;
    parent_tool_use_id: string | null;
}
/** Replayed user message with required UUID */
interface SDKUserMessageReplay {
    type: 'user';
    uuid: UUID;
    session_id: string;
    message: APIUserMessage;
    parent_tool_use_id: string | null;
}
/** Success result message */
interface SDKResultMessageSuccess {
    type: 'result';
    subtype: 'success';
    uuid: UUID;
    session_id: string;
    duration_ms: number;
    duration_api_ms: number;
    is_error: boolean;
    num_turns: number;
    result: string;
    total_cost_usd: number;
    usage: NonNullableUsage;
    modelUsage: {
        [modelName: string]: ModelUsage;
    };
    permission_denials: SDKPermissionDenial[];
    structured_output?: unknown;
}
/** Error result message */
interface SDKResultMessageError {
    type: 'result';
    subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
    uuid: UUID;
    session_id: string;
    duration_ms: number;
    duration_api_ms: number;
    is_error: boolean;
    num_turns: number;
    total_cost_usd: number;
    usage: NonNullableUsage;
    modelUsage: {
        [modelName: string]: ModelUsage;
    };
    permission_denials: SDKPermissionDenial[];
    errors: string[];
}
/** Final result message */
type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;
/** System initialization message */
interface SDKSystemMessage {
    type: 'system';
    subtype: 'init';
    uuid: UUID;
    session_id: string;
    apiKeySource: ApiKeySource;
    cwd: string;
    tools: string[];
    mcp_servers: {
        name: string;
        status: string;
    }[];
    model: string;
    permissionMode: PermissionMode;
    slash_commands: string[];
    output_style: string;
}
/** Streaming partial message */
interface SDKPartialAssistantMessage {
    type: 'stream_event';
    event: RawMessageStreamEvent;
    parent_tool_use_id: string | null;
    uuid: UUID;
    session_id: string;
}
/** Conversation compaction boundary message */
interface SDKCompactBoundaryMessage {
    type: 'system';
    subtype: 'compact_boundary';
    uuid: UUID;
    session_id: string;
    compact_metadata: {
        trigger: 'manual' | 'auto';
        pre_tokens: number;
    };
}
/** Union type of all possible messages */
type SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay | SDKResultMessage | SDKSystemMessage | SDKPartialAssistantMessage | SDKCompactBoundaryMessage;

/**
 * Hook types for event handling
 */

/** Available hook events */
type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Notification' | 'UserPromptSubmit' | 'SessionStart' | 'SessionEnd' | 'Stop' | 'SubagentStart' | 'SubagentStop' | 'PreCompact' | 'PermissionRequest';
/** Exit reason for session end */
type ExitReason = 'success' | 'error' | 'max_turns' | 'max_budget' | 'user_interrupt' | 'abort';
/** Base hook input interface */
interface BaseHookInput {
    session_id: string;
    transcript_path: string;
    cwd: string;
    permission_mode?: string;
}
/** PreToolUse hook input */
interface PreToolUseHookInput extends BaseHookInput {
    hook_event_name: 'PreToolUse';
    tool_name: string;
    tool_input: unknown;
}
/** PostToolUse hook input */
interface PostToolUseHookInput extends BaseHookInput {
    hook_event_name: 'PostToolUse';
    tool_name: string;
    tool_input: unknown;
    tool_response: unknown;
}
/** PostToolUseFailure hook input */
interface PostToolUseFailureHookInput extends BaseHookInput {
    hook_event_name: 'PostToolUseFailure';
    tool_name: string;
    tool_input: unknown;
    error: string;
    is_interrupt?: boolean;
}
/** Notification hook input */
interface NotificationHookInput extends BaseHookInput {
    hook_event_name: 'Notification';
    message: string;
    title?: string;
}
/** UserPromptSubmit hook input */
interface UserPromptSubmitHookInput extends BaseHookInput {
    hook_event_name: 'UserPromptSubmit';
    prompt: string;
}
/** SessionStart hook input */
interface SessionStartHookInput extends BaseHookInput {
    hook_event_name: 'SessionStart';
    source: 'startup' | 'resume' | 'clear' | 'compact';
}
/** SessionEnd hook input */
interface SessionEndHookInput extends BaseHookInput {
    hook_event_name: 'SessionEnd';
    reason: ExitReason;
}
/** Stop hook input */
interface StopHookInput extends BaseHookInput {
    hook_event_name: 'Stop';
    stop_hook_active: boolean;
}
/** SubagentStart hook input */
interface SubagentStartHookInput extends BaseHookInput {
    hook_event_name: 'SubagentStart';
    agent_id: string;
    agent_type: string;
}
/** SubagentStop hook input */
interface SubagentStopHookInput extends BaseHookInput {
    hook_event_name: 'SubagentStop';
    stop_hook_active: boolean;
}
/** PreCompact hook input */
interface PreCompactHookInput extends BaseHookInput {
    hook_event_name: 'PreCompact';
    trigger: 'manual' | 'auto';
    custom_instructions: string | null;
}
/** PermissionRequest hook input */
interface PermissionRequestHookInput extends BaseHookInput {
    hook_event_name: 'PermissionRequest';
    tool_name: string;
    tool_input: unknown;
    permission_suggestions?: PermissionUpdate[];
}
/** Union type of all hook input types */
type HookInput = PreToolUseHookInput | PostToolUseHookInput | PostToolUseFailureHookInput | NotificationHookInput | UserPromptSubmitHookInput | SessionStartHookInput | SessionEndHookInput | StopHookInput | SubagentStartHookInput | SubagentStopHookInput | PreCompactHookInput | PermissionRequestHookInput;
/** Async hook output */
interface AsyncHookJSONOutput {
    async: true;
    asyncTimeout?: number;
}
/** PreToolUse specific hook output */
interface PreToolUseHookSpecificOutput {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
}
/** UserPromptSubmit specific hook output */
interface UserPromptSubmitHookSpecificOutput {
    hookEventName: 'UserPromptSubmit';
    additionalContext?: string;
}
/** SessionStart specific hook output */
interface SessionStartHookSpecificOutput {
    hookEventName: 'SessionStart';
    additionalContext?: string;
}
/** PostToolUse specific hook output */
interface PostToolUseHookSpecificOutput {
    hookEventName: 'PostToolUse';
    additionalContext?: string;
}
/** Sync hook output */
interface SyncHookJSONOutput {
    continue?: boolean;
    suppressOutput?: boolean;
    stopReason?: string;
    decision?: 'approve' | 'block';
    systemMessage?: string;
    reason?: string;
    hookSpecificOutput?: PreToolUseHookSpecificOutput | UserPromptSubmitHookSpecificOutput | SessionStartHookSpecificOutput | PostToolUseHookSpecificOutput;
}
/** Hook return value */
type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput;
/** Hook callback function type */
type HookCallback = (input: HookInput, toolUseID: string | undefined, options: {
    signal: AbortSignal;
}) => Promise<HookJSONOutput>;
/** Hook configuration with optional matcher */
interface HookCallbackMatcher {
    matcher?: string;
    hooks: HookCallback[];
}

/**
 * MCP (Model Context Protocol) types
 */

/** MCP tool result content */
interface McpToolResultContent {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    [key: string]: unknown;
}
/** MCP tool call result */
interface CallToolResult {
    content: McpToolResultContent[];
    isError?: boolean;
}
/** MCP stdio server configuration */
interface McpStdioServerConfig {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    /**
     * Indicates whether this server acts as a proxy aggregating
     * multiple backend MCP servers. Proxied tool names use the format:
     * mcp__{server_name}__{tool_name}
     */
    isProxy?: boolean;
}
/** MCP SSE server configuration */
interface McpSSEServerConfig {
    type: 'sse';
    url: string;
    headers?: Record<string, string>;
    /**
     * Indicates whether this server acts as a proxy aggregating
     * multiple backend MCP servers. Proxied tool names use the format:
     * mcp__{server_name}__{tool_name}
     */
    isProxy?: boolean;
}
/** MCP HTTP server configuration */
interface McpHttpServerConfig {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
    /**
     * Indicates whether this server acts as a proxy aggregating
     * multiple backend MCP servers. Proxied tool names use the format:
     * mcp__{server_name}__{tool_name}
     */
    isProxy?: boolean;
}
/** MCP Server interface (minimal representation) */
interface McpServer {
    connect(): Promise<void>;
    close(): Promise<void>;
}
/** MCP SDK server config with instance */
interface McpSdkServerConfigWithInstance {
    type: 'sdk';
    name: string;
    instance: McpServer;
}
/** Union of MCP server configurations */
type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance;
/** SDK MCP tool definition */
interface SdkMcpToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
    name: string;
    description: string;
    inputSchema: Schema;
    handler: (args: z.infer<ZodObject<Schema>>, extra: unknown) => Promise<CallToolResult>;
}

/**
 * Sandbox configuration types
 */
/** Network-specific configuration for sandbox mode */
interface NetworkSandboxSettings {
    /** Allow processes to bind to local ports (e.g., for dev servers) */
    allowLocalBinding?: boolean;
    /** Unix socket paths that processes can access (e.g., Docker socket) */
    allowUnixSockets?: string[];
    /** Allow access to all Unix sockets */
    allowAllUnixSockets?: boolean;
    /** HTTP proxy port for network requests */
    httpProxyPort?: number;
    /** SOCKS proxy port for network requests */
    socksProxyPort?: number;
}
/** Configuration for ignoring specific sandbox violations */
interface SandboxIgnoreViolations {
    /** File path patterns to ignore violations for */
    file?: string[];
    /** Network patterns to ignore violations for */
    network?: string[];
}
/** Configuration for sandbox behavior */
interface SandboxSettings {
    /** Enable sandbox mode for command execution */
    enabled?: boolean;
    /** Auto-approve bash commands when sandbox is enabled */
    autoAllowBashIfSandboxed?: boolean;
    /** Commands that always bypass sandbox restrictions (e.g., ['docker']) */
    excludedCommands?: string[];
    /** Allow the model to request running commands outside the sandbox */
    allowUnsandboxedCommands?: boolean;
    /** Network-specific sandbox configuration */
    network?: NetworkSandboxSettings;
    /** Configure which sandbox violations to ignore */
    ignoreViolations?: SandboxIgnoreViolations;
    /** Enable a weaker nested sandbox for compatibility */
    enableWeakerNestedSandbox?: boolean;
}

/**
 * Options and configuration types
 */

/** Agent definition for subagents */
interface AgentDefinition {
    /** Natural language description of when to use this agent */
    description: string;
    /** Array of allowed tool names. If omitted, inherits all tools */
    tools?: string[];
    /** The agent's system prompt */
    prompt: string;
    /** Model override for this agent. If omitted, uses the main model */
    model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}
/** Plugin configuration */
interface SdkPluginConfig {
    /** Must be 'local' (only local plugins currently supported) */
    type: 'local';
    /** Absolute or relative path to the plugin directory */
    path: string;
}
/** Permission result - allow */
interface PermissionResultAllow {
    behavior: 'allow';
    updatedInput: ToolInput;
    updatedPermissions?: PermissionUpdate[];
}
/** Permission result - deny */
interface PermissionResultDeny {
    behavior: 'deny';
    message: string;
    interrupt?: boolean;
}
/** Result of a permission check */
type PermissionResult = PermissionResultAllow | PermissionResultDeny;
/** Context for tool permission callback */
interface ToolPermissionContext {
    /** Abort signal for cancellation */
    signal: AbortSignal;
    /** Permission suggestions from CLI */
    suggestions?: PermissionUpdate[];
    /** Unique identifier for this tool use (for tracking async responses) */
    toolUseID: string;
}
/** Custom permission function type */
type CanUseTool = (toolName: string, input: ToolInput, options: ToolPermissionContext) => Promise<PermissionResult>;
/** System prompt configuration */
type SystemPromptConfig = string | {
    type: 'preset';
    preset: 'qoder';
    append?: string;
};
/** Tools configuration */
type ToolsConfig = string[] | {
    type: 'preset';
    preset: 'qoder';
};
/** Output format configuration */
interface OutputFormatConfig {
    type: 'json_schema';
    schema: JSONSchema;
}
/** Configuration object for the query() function */
interface Options {
    /** Controller for cancelling operations */
    abortController?: AbortController;
    /** Additional directories Qoder can access */
    additionalDirectories?: string[];
    /** Programmatically define subagents */
    agents?: Record<string, AgentDefinition>;
    /** Enable bypassing permissions. Required when using permissionMode: 'bypassPermissions' */
    allowDangerouslySkipPermissions?: boolean;
    /** List of allowed tool names */
    allowedTools?: string[];
    /** Enable beta features (e.g., ['context-1m-2025-08-07']) */
    betas?: SdkBeta[];
    /** Custom permission function for tool usage */
    canUseTool?: CanUseTool;
    /** Continue the most recent conversation */
    continue?: boolean;
    /** Current working directory */
    cwd?: string;
    /** List of disallowed tool names */
    disallowedTools?: string[];
    /** Enable file change tracking for rewinding */
    enableFileCheckpointing?: boolean;
    /** Environment variables */
    env?: Dict<string>;
    /** JavaScript runtime to use */
    executable?: 'bun' | 'deno' | 'node';
    /** Arguments to pass to the executable */
    executableArgs?: string[];
    /** Additional arguments */
    extraArgs?: Record<string, string | null>;
    /** Model to use if primary fails */
    fallbackModel?: string;
    /** When resuming with resume, fork to a new session ID instead of continuing the original session */
    forkSession?: boolean;
    /** Hook callbacks for events */
    hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
    /** Include partial message events */
    includePartialMessages?: boolean;
    /** Maximum budget in USD for the query */
    maxBudgetUsd?: number;
    /** Maximum tokens for thinking process */
    maxThinkingTokens?: number;
    /** Maximum conversation turns */
    maxTurns?: number;
    /** MCP server configurations */
    mcpServers?: Record<string, McpServerConfig>;
    /** Qoder model to use */
    model?: string;
    /** Define output format for agent results */
    outputFormat?: OutputFormatConfig;
    /** Path to Qoder executable */
    pathToQoderCLIExecutable?: string;
    /** Permission mode for the session */
    permissionMode?: PermissionMode;
    /** MCP tool name for permission prompts */
    permissionPromptToolName?: string;
    /** Load custom plugins from local paths */
    plugins?: SdkPluginConfig[];
    /** Session ID to resume */
    resume?: string;
    /** Resume session at a specific message UUID */
    resumeSessionAt?: string;
    /** Configure sandbox behavior programmatically */
    sandbox?: SandboxSettings;
    /** Control which filesystem settings to load */
    settingSources?: SettingSource[];
    /** Session ID for the connection */
    sessionId?: string;
    /** Callback for stderr output */
    stderr?: (data: string) => void;
    /** Custom storage directory for CLI data */
    storageDir?: string;
    /** Custom resource directory for CLI resources */
    resourceDir?: string;
    /** Integration mode for the SDK */
    integrationMode?: IntegrationMode;
    /** Enforce strict MCP validation */
    strictMcpConfig?: boolean;
    /** System prompt configuration */
    systemPrompt?: SystemPromptConfig;
    /** Tool configuration */
    tools?: ToolsConfig;
}

/**
 * Account operation types
 *
 * Types for login, logout, status, feedback, and access check operations.
 * All operations are accessed through QoderAgentSDKClient methods.
 */
/**
 * Result of the login operation
 */
interface LoginResult {
    success: boolean;
    message: string;
    username?: string;
}
/**
 * Result of the startLogin operation (returns login URL without opening browser)
 */
interface StartLoginResult {
    success: boolean;
    /** OAuth 登录页面 URL，由调用方自行拉起浏览器 */
    loginUrl?: string;
    /** 如果已登录则为 true */
    alreadyLoggedIn?: boolean;
    username?: string;
    message?: string;
}
/**
 * Result of the logout operation
 */
interface LogoutResult {
    success: boolean;
    message: string;
}
/**
 * User status information from Qoder CLI
 */
interface StatusInfo {
    /** Whether the user is logged in */
    loggedIn: boolean;
    /** Username of the logged-in user */
    username: string;
    /** Email of the logged-in user */
    email: string;
    /** Avatar URL of the logged-in user */
    avatarUrl: string;
    /** User type (e.g., "personal_standard") */
    userType: string;
    /** Subscription plan (e.g., "Free", "Pro") */
    plan: string;
    /** CLI version */
    version: string;
}
/**
 * Result of the Qoder Work access check
 */
interface QoderWorkAccessResult {
    /** Whether the user has Qoder Work beta access */
    invited: boolean;
}
/**
 * Result of the feedback operation
 */
interface FeedbackResult {
    success: boolean;
    message: string;
    /** 反馈请求 ID，提交成功时返回 */
    requestId?: string;
}
/**
 * User quota information
 */
interface UserQuota {
    /** Total quota amount */
    total: number;
    /** Used quota amount */
    used: number;
    /** Remaining quota amount */
    remaining: number;
    /** Usage percentage (0-100) */
    percentage: number;
    /** Unit of quota (e.g., "USD") */
    unit: string;
}
/**
 * Add-on quota information
 */
interface AddOnQuota {
    total: number;
    used: number;
    remaining: number;
    percentage: number;
    unit: string;
    detailUrl: string;
}
/**
 * Organization Resource Package
 */
interface OrgResourcePackage {
    /** Used quota amount */
    used: number;
    /** Quota cap (upper limit for this member) */
    cap: number;
    /** Remaining quota amount */
    remaining: number;
    /** Usage percentage (0-100) */
    percentage: number;
    /** Whether the org resource package is available */
    available: boolean;
    /** Unit of quota (e.g., "credits") */
    unit: string;
}
/**
 * Result of the case submit enabled check
 */
interface CaseSubmitEnabledResult {
    /** Whether case submit is enabled */
    enabled: boolean;
}
/**
 * Model configuration from server
 */
interface ModelConfig {
    /** Unique key identifier, e.g. "deepseek-v3" */
    key: string;
    /** Display name for UI */
    displayName: string;
    /** Output format, e.g. "openai", "dashscope" */
    format: string;
    /** Whether the model supports multimodal (vision) */
    isVl: boolean;
    /** Whether the model supports reasoning */
    isReasoning: boolean;
    /** Optional model URL */
    url: string;
    /** Source type: "system" or "user" */
    source: string;
    /** Max input token limit */
    maxInputTokens: number;
    /** Whether the model is enabled */
    enable: boolean;
    /** Price factor */
    priceFactor: number;
    /** Original price factor */
    originalPriceFactor: number;
    /** Whether this is the default model */
    isDefault: boolean;
    /** Whether this is a new model */
    isNew: boolean;
    /** Model tags, e.g. ["limited_time_free"] */
    tags: string[];
    /** Model provider */
    modelProvider: string;
    /** Max output token limit */
    maxOutputTokens: number;
}
/**
 * Options for filtering models
 */
interface GetModelsOptions {
    /** Filter models by scene */
    scene?: string;
}
/**
 * Result of getModels operation
 */
interface ModelsResult {
    /** List of available models */
    models: ModelConfig[];
}
/**
 * Account usage information
 */
interface UsageInfo {
    /** User ID */
    userId: string;
    /** User type (e.g., "personal_professional", "teams") */
    userType: string;
    /** Total usage percentage (0-100) */
    totalUsagePercentage: number;
    /** Whether user is on the highest tier */
    isHighestTier: boolean;
    /** Quota expiration timestamp (milliseconds) */
    expiresAt: number;
    /** URL to upgrade plan */
    upgradeUrl: string;
    /** User quota details */
    userQuota: UserQuota;
    /** User add-on quota details */
    addOnQuota: AddOnQuota;
    /** Whether quota is exceeded */
    isQuotaExceeded: boolean;
    /** Whether this is a prorated quota period for Team users */
    isPlanQuotaProrated: boolean;
    /** Organization Resource Package */
    orgResourcePackage: OrgResourcePackage;
}

/**
 * Telemetry tracking types
 */
/**
 * Generic tracking event - a map of key-value pairs.
 * Required fields: event_type, session_id
 * Optional fields: message_id, business_id, and any custom fields
 */
type TrackingEvent = Record<string, unknown> & {
    event_type: string;
    session_id: string;
};
/**
 * Response from tracking control request
 */
interface TrackingResponse {
    success: boolean;
    event_type?: string;
    error?: string;
}

/**
 * Transport interface for Qoder SDK communication
 */
/**
 * Abstract transport for Qoder communication.
 *
 * This is a low-level transport interface that handles raw I/O with the Qoder
 * process or service. The Query class builds on top of this to implement the
 * control protocol and message routing.
 */
interface Transport {
    /**
     * Connect the transport and prepare for communication.
     * For subprocess transports, this starts the process.
     * For network transports, this establishes the connection.
     */
    connect(): Promise<void>;
    /**
     * Write raw data to the transport.
     * @param data - Raw string data to write (typically JSON + newline)
     */
    write(data: string): Promise<void>;
    /**
     * Read and parse messages from the transport.
     * @returns AsyncIterator that yields parsed JSON messages
     */
    readMessages(): AsyncIterableIterator<Record<string, unknown>>;
    /**
     * Close the transport connection and clean up resources.
     */
    close(): Promise<void>;
    /**
     * Check if transport is ready for communication.
     * @returns True if transport is ready to send/receive messages
     */
    isReady(): boolean;
    /**
     * Transport 断开连接时 reject 的 Promise，用于让 control request 快速失败。
     * - SubprocessTransport: 子进程退出时 reject
     * - TcpTransport: socket 关闭/出错时 reject
     */
    getDisconnectPromise(): Promise<never>;
    /**
     * End the input stream (close stdin for process transports).
     */
    endInput(): Promise<void>;
    /**
     * Prepare for query execution. Called before a query is sent.
     * Can be used to perform any necessary setup or validation.
     * @param messages - Optional messages to be sent (for extracting metadata like additional folders)
     */
    queryPrepare(messages?: unknown[]): Promise<void>;
}

/**
 * Query function and interface for Qoder Agent SDK
 */

/**
 * Query interface returned by the query() function.
 * Extends AsyncGenerator to provide streaming message access.
 */
interface Query extends AsyncGenerator<SDKMessage, void, undefined> {
    /**
     * Interrupts the query (only available in streaming input mode)
     */
    interrupt(): Promise<void>;
    /**
     * Restores files to their state at the specified user message.
     * Requires enableFileCheckpointing: true
     * @param userMessageUuid - The UUID of the user message to rewind to
     */
    rewindFiles(userMessageUuid: string): Promise<void>;
    /**
     * Changes the permission mode (only available in streaming input mode)
     * @param mode - The new permission mode
     */
    setPermissionMode(mode: PermissionMode): Promise<void>;
    /**
     * Changes the model (only available in streaming input mode)
     * @param model - The new model to use
     */
    setModel(model?: string): Promise<void>;
    /**
     * Changes the maximum thinking tokens (only available in streaming input mode)
     * @param maxThinkingTokens - The new maximum thinking tokens (null to disable)
     */
    setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
    /**
     * Returns available slash commands
     */
    supportedCommands(): Promise<SlashCommand[]>;
    /**
     * Returns available models with display info
     */
    supportedModels(): Promise<ModelInfo[]>;
    /**
     * Returns status of connected MCP servers
     */
    mcpServerStatus(): Promise<McpServerStatus[]>;
    /**
     * Returns account information
     */
    accountInfo(): Promise<AccountInfo>;
}
/** Query function parameters */
interface QueryParams {
    /** The input prompt as a string or async iterable for streaming mode */
    prompt: string | AsyncIterable<SDKUserMessage>;
    /** Optional configuration object */
    options?: Options;
    /** Optional custom transport implementation */
    transport?: Transport;
}
/**
 * The primary function for interacting with Qoder.
 * Creates an async generator that streams messages as they arrive.
 *
 * @param params - Query parameters including prompt and options
 * @returns A Query object that extends AsyncGenerator with additional methods
 *
 * @example
 * ```typescript
 * import { query } from '@anthropic-ai/qoder-agent-sdk';
 *
 * const result = query({
 *   prompt: "Hello, Qoder!",
 *   options: {
 *     model: "qoder-sonnet-4-20250514",
 *   }
 * });
 *
 * for await (const message of result) {
 *   console.log(message);
 * }
 * ```
 */
declare function query(params: QueryParams): Query;

/**
 * Subprocess transport implementation using Qoder CLI
 */

interface SubprocessTransportOptions {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options: Options;
}
/**
 * Subprocess transport using Qoder CLI
 */
declare class SubprocessTransport implements Transport {
    private prompt;
    private isStreaming;
    private options;
    private cliPath;
    private cwd?;
    private process;
    private stdoutReader;
    private ready;
    private exitError;
    private maxBufferSize;
    private tempFiles;
    private writeLock;
    private _disconnectPromise;
    private _disconnectReject;
    constructor({ prompt, options }: SubprocessTransportOptions);
    private resetDisconnectPromise;
    /**
     * Find Qoder CLI binary
     */
    private findCli;
    /**
     * Find bundled CLI binary if it exists
     */
    private findBundledCli;
    /**
     * Build settings value, merging sandbox settings if provided
     */
    private buildSettingsValue;
    /**
     * Build CLI command with arguments
     */
    private buildCommand;
    connect(): Promise<void>;
    write(data: string): Promise<void>;
    readMessages(): AsyncIterableIterator<Record<string, unknown>>;
    close(): Promise<void>;
    endInput(): Promise<void>;
    isReady(): boolean;
    getDisconnectPromise(): Promise<never>;
    queryPrepare(_messages?: unknown[]): Promise<void>;
}

/**
 * TCP/Unix Socket/Named Pipe transport implementation for direct socket connection
 *
 * Supports three endpoint types:
 * - TCP: "host:port" format (e.g., "192.168.64.10:1024")
 * - Unix Socket: absolute path format (e.g., "/tmp/qoderwork-chat.sock")
 * - Windows Named Pipe: pipe path format (e.g., "\\\\.\pipe\\qoderwork-chat" or "//./pipe/qoderwork-chat")
 *
 * Endpoint type is auto-detected: paths starting with "/" are treated as
 * Unix Sockets, Windows pipe paths are treated as Named Pipes,
 * everything else is parsed as TCP host:port.
 */

interface TcpTransportOptions {
    prompt?: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
    chatEndpoint?: string;
    apiBaseUrl?: string;
}
interface IsConnectableOptions {
    chatEndpoint?: string;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
}
/**
 * Check if the remote endpoint is connectable via TCP or Unix Socket
 * @param options - Configuration options for connection check
 * @returns Promise<boolean> - true if connectable, false otherwise
 */
declare function isConnectable(options?: IsConnectableOptions): Promise<boolean>;
/**
 * Socket transport for direct connection to remote VM (TCP or Unix Socket)
 */
declare class TcpTransport implements Transport {
    private prompt;
    private isStreaming;
    private options;
    private socket;
    private socketReader;
    private ready;
    private exitError;
    private maxBufferSize;
    private writeLock;
    private chatEndpoint;
    private _disconnectPromise;
    private _disconnectReject;
    constructor({ prompt, options, chatEndpoint }?: TcpTransportOptions);
    private resetDisconnectPromise;
    connect(): Promise<void>;
    write(data: string): Promise<void>;
    readMessages(): AsyncIterableIterator<Record<string, unknown>>;
    close(): Promise<void>;
    endInput(): Promise<void>;
    isReady(): boolean;
    getDisconnectPromise(): Promise<never>;
    queryPrepare(messages?: unknown[]): Promise<void>;
    /**
     * Get account ID from options or generate from cwd
     */
    private getAccountId;
    /**
     * Generate sessionId from cwd using SHA-256 hash
     */
    private generateSessionId;
}

/**
 * Query handler for bidirectional control protocol
 */

/**
 * Account operation types supported by the CLI
 */
type AccountOperationType = 'login' | 'logout' | 'status' | 'qoder_work_check' | 'usage' | 'case_submit_enabled' | 'models' | 'start_login' | 'complete_login';
/**
 * Response from account operation control request
 */
interface AccountOperationResponse {
    /** Whether the operation succeeded */
    success: boolean;
    /** The operation type */
    operation: AccountOperationType;
    /** Operation-specific data */
    data?: Record<string, unknown>;
    /** Error message if success is false */
    error?: string;
}
interface QueryHandlerOptions {
    transport: Transport;
    isStreamingMode: boolean;
    canUseTool?: CanUseTool;
    hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
    sdkMcpServers?: Record<string, McpServer>;
    initializeTimeout?: number;
}
/**
 * Handles bidirectional control protocol on top of Transport.
 *
 * This class manages:
 * - Control request/response routing
 * - Hook callbacks
 * - Tool permission callbacks
 * - Message streaming
 * - Initialization handshake
 */
declare class QueryHandler {
    private transport;
    private isStreamingMode;
    private canUseTool?;
    private hooks;
    private sdkMcpServers;
    private initializeTimeout;
    private pendingControlResponses;
    private hookCallbacks;
    private nextCallbackId;
    private requestCounter;
    private messageQueue;
    private messageResolvers;
    private initialized;
    private closed;
    private initializationResult;
    private firstResultReceived;
    private firstResultResolvers;
    private readingMessages;
    constructor(options: QueryHandlerOptions);
    /**
     * Initialize control protocol if in streaming mode
     */
    initialize(): Promise<Record<string, unknown> | null>;
    /**
     * Start reading messages from transport
     */
    start(): Promise<void>;
    /**
     * Background message reading loop
     */
    private readMessagesLoop;
    /**
     * Enqueue a message for consumers
     */
    private enqueueMessage;
    /**
     * Handle incoming control request from CLI
     */
    private handleControlRequest;
    /**
     * Send control request to CLI and wait for response
     */
    private sendControlRequest;
    /**
     * Handle an MCP request for an SDK server
     */
    private handleSdkMcpRequest;
    /**
     * Send interrupt control request
     */
    interrupt(): Promise<void>;
    /**
     * Change permission mode
     */
    setPermissionMode(mode: string): Promise<void>;
    /**
     * Change the AI model
     */
    setModel(model?: string): Promise<void>;
    /**
     * Change max thinking tokens
     */
    setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
    /**
     * Rewind tracked files to their state at a specific user message
     */
    rewindFiles(userMessageId: string): Promise<void>;
    /**
     * Send an account operation control request to CLI.
     *
     * @param operation - The account operation type
     * @param data - Optional operation-specific data (required for feedback)
     * @param timeout - Timeout in seconds (default: 30s, login: 300s)
     * @returns AccountOperationResponse with success status and data
     */
    sendAccountOperation(operation: AccountOperationType, data?: Record<string, unknown>, timeout?: number): Promise<AccountOperationResponse>;
    /**
     * Send a tracking event to CLI.
     *
     * @param event - The tracking event to send (must have event_type and session_id)
     * @param timeout - Timeout in seconds (default: 10s)
     * @returns TrackingResponse with success status
     */
    sendTrackingEvent(event: TrackingEvent, timeout?: number): Promise<TrackingResponse>;
    /**
     * Stream input messages to transport
     */
    streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
    /**
     * Receive SDK messages (not control messages)
     */
    receiveMessages(): AsyncIterableIterator<SDKMessage>;
    /**
     * Receive raw messages (for internal use)
     */
    receiveRawMessages(): AsyncIterableIterator<Record<string, unknown>>;
    /**
     * Get initialization result
     */
    getInitializationResult(): Record<string, unknown> | null;
    /**
     * Close the query and transport
     */
    close(): Promise<void>;
}

/**
 * Qoder SDK Client for bidirectional, interactive conversations
 */

/**
 * Client for bidirectional, interactive conversations with Qoder.
 *
 * This client provides full control over the conversation flow with support
 * for streaming, interrupts, and dynamic message sending. For simple one-shot
 * queries, consider using the query() function instead.
 *
 * Key features:
 * - **Bidirectional**: Send and receive messages at any time
 * - **Stateful**: Maintains conversation context across messages
 * - **Interactive**: Send follow-ups based on responses
 * - **Control flow**: Support for interrupts and session management
 *
 * @example
 * ```typescript
 * const client = new QoderAgentSDKClient();
 * await client.connect();
 *
 * await client.query("Hello, Qoder!");
 *
 * for await (const message of client.receiveResponse()) {
 *   console.log(message);
 * }
 *
 * await client.disconnect();
 * ```
 */
declare class QoderAgentSDKClient {
    private options;
    private customTransport?;
    private transport;
    private queryHandler;
    constructor(options?: Options, transport?: Transport);
    /**
     * Connect to Qoder with an optional prompt or message stream.
     */
    connect(prompt?: string | AsyncIterable<SDKUserMessage>): Promise<void>;
    /**
     * Receive all messages from Qoder.
     */
    receiveMessages(): AsyncIterableIterator<SDKMessage>;
    /**
     * Send a new query in streaming mode.
     */
    query(prompt: string | AsyncIterable<SDKUserMessage>, sessionId?: string): Promise<void>;
    /**
     * Send interrupt signal (only works with streaming mode).
     */
    interrupt(): Promise<void>;
    /**
     * Change permission mode during conversation.
     */
    setPermissionMode(mode: PermissionMode): Promise<void>;
    /**
     * Change the AI model during conversation.
     */
    setModel(model?: string): Promise<void>;
    /**
     * Rewind tracked files to their state at a specific user message.
     */
    rewindFiles(userMessageId: string): Promise<void>;
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
    login(): Promise<LoginResult>;
    /**
     * Start login flow without opening browser.
     *
     * Returns the login URL for the caller to open in their own browser.
     * After opening the URL, call waitForLoginComplete() to wait for the
     * user to finish authentication.
     *
     * @returns StartLoginResult with loginUrl
     */
    startLogin(): Promise<StartLoginResult>;
    /**
     * Wait for a previously started login flow to complete.
     *
     * Blocks until the user finishes browser authentication.
     * Must be called after startLogin().
     *
     * @returns LoginResult with success status
     */
    waitForLoginComplete(): Promise<LoginResult>;
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
    logout(): Promise<LogoutResult>;
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
    getStatus(): Promise<StatusInfo>;
    /**
     * Check Qoder Work access using the current connection.
     * @returns QoderWorkAccessResult with invited status
     */
    checkQoderWorkAccess(): Promise<QoderWorkAccessResult>;
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
    getUsage(): Promise<UsageInfo>;
    /**
     * Check if case submit is enabled for the current user.
     *
     * Sends a heartbeat request to the server and extracts the
     * case submit enabled status from the response.
     *
     * @returns CaseSubmitEnabledResult with enabled status
     *
     * @example
     * ```typescript
     * const result = await client.getCaseSubmitEnabled();
     * if (result.enabled) {
     *   console.log('Case submit is enabled');
     * }
     * ```
     */
    getCaseSubmitEnabled(): Promise<CaseSubmitEnabledResult>;
    /**
     * Get available model list.
     *
     * @param options - Optional filtering options
     * @returns ModelsResult with list of available models
     *
     * @example
     * ```typescript
     * const result = await client.getModels();
     * for (const model of result.models) {
     *   console.log(`${model.key} - ${model.displayName}`);
     * }
     *
     * // Filter by scene
     * const filteredResult = await client.getModels({ scene: 'chat' });
     * ```
     */
    getModels(options?: GetModelsOptions): Promise<ModelsResult>;
    /**
     * Get server initialization info.
     */
    getServerInfo(): Promise<Record<string, unknown> | null>;
    /**
     * Receive messages until and including a ResultMessage.
     */
    receiveResponse(): AsyncIterableIterator<SDKMessage>;
    /**
     * Get SDK and CLI version information.
     */
    getVersion(): {
        sdkVersion: string;
        cliVersion: string;
        sdkCommitHash: string;
        cliCommitHash: string;
    };
    /**
     * Disconnect from Qoder.
     */
    disconnect(): Promise<void>;
    /**
     * Async context manager support - enter.
     */
    [Symbol.asyncDispose](): Promise<void>;
}

/**
 * 独立的 feedback 提交模块
 *
 * 通过 spawn qodercli feedback 子进程的方式提交反馈，
 * 不依赖 SDK Client 连接（无需 connect()）。
 */

/**
 * feedback 提交参数
 */
interface SubmitFeedbackParams {
    /** 反馈内容（必填） */
    content: string;
    /** 会话 ID */
    sessionId?: string;
    /** 工作目录 */
    workdir?: string;
    /** 附加诊断路径列表 */
    include?: string[];
    /** 截图文件路径列表（最多 5 张） */
    imagePaths?: string[];
    /** 联系邮箱 */
    email?: string;
}
/**
 * feedback 提交选项
 */
interface SubmitFeedbackOptions {
    /** qodercli 二进制路径；未提供时自动查找 */
    cliPath?: string;
    /** 子进程环境变量 */
    env?: Record<string, string>;
    /** 超时时间（毫秒），默认 60000 */
    timeout?: number;
    /** 存储目录；未提供时使用全局配置 configure() 中设置的 storageDir */
    storageDir?: string;
}
/**
 * 通过 qodercli feedback 子命令提交反馈。
 *
 * 不需要 SDK Client 连接，直接 spawn 一次性子进程完成提交。
 *
 * @example
 * ```typescript
 * import { submitFeedback } from '@ali/qoder-agent-sdk';
 *
 * const result = await submitFeedback(
 *   { content: 'Great experience!', sessionId: 'abc123' },
 *   { cliPath: '/path/to/qodercli' },
 * );
 * console.log(result.success, result.message);
 * ```
 */
declare function submitFeedback(params: SubmitFeedbackParams, options?: SubmitFeedbackOptions): Promise<FeedbackResult>;

/**
 * MCP (Model Context Protocol) utilities
 */

/**
 * Creates a type-safe MCP tool definition for use with SDK MCP servers.
 *
 * @param name - The name of the tool
 * @param description - A description of what the tool does
 * @param inputSchema - Zod schema defining the tool's input parameters
 * @param handler - Async function that executes the tool logic
 * @returns A tool definition that can be used with createSdkMcpServer
 *
 * @example
 * ```typescript
 * import { tool, createSdkMcpServer } from '@anthropic-ai/qoder-agent-sdk';
 * import { z } from 'zod';
 *
 * const myTool = tool(
 *   'greet',
 *   'Greets a user by name',
 *   { name: z.string().describe('The name to greet') },
 *   async ({ name }) => ({
 *     content: [{ type: 'text', text: `Hello, ${name}!` }]
 *   })
 * );
 *
 * const server = createSdkMcpServer({
 *   name: 'my-server',
 *   tools: [myTool]
 * });
 * ```
 */
declare function tool<Schema extends ZodRawShape>(name: string, description: string, inputSchema: Schema, handler: (args: z.infer<ZodObject<Schema>>, extra: unknown) => Promise<CallToolResult>): SdkMcpToolDefinition<Schema>;
/** Options for creating an SDK MCP server */
interface CreateSdkMcpServerOptions {
    /** The name of the MCP server */
    name: string;
    /** Optional version string */
    version?: string;
    /** Array of tool definitions created with tool() */
    tools?: Array<SdkMcpToolDefinition<ZodRawShape>>;
}
/**
 * Creates an MCP server instance that runs in the same process as your application.
 *
 * @param options - Server configuration options
 * @returns An MCP server configuration with the instance
 *
 * @example
 * ```typescript
 * import { query, createSdkMcpServer, tool } from '@anthropic-ai/qoder-agent-sdk';
 * import { z } from 'zod';
 *
 * const weatherTool = tool(
 *   'get_weather',
 *   'Gets the current weather for a location',
 *   {
 *     location: z.string().describe('City name'),
 *     unit: z.enum(['celsius', 'fahrenheit']).optional()
 *   },
 *   async ({ location, unit = 'celsius' }) => ({
 *     content: [{
 *       type: 'text',
 *       text: `Weather in ${location}: 22°${unit === 'celsius' ? 'C' : 'F'}`
 *     }]
 *   })
 * );
 *
 * const server = createSdkMcpServer({
 *   name: 'weather-server',
 *   version: '1.0.0',
 *   tools: [weatherTool]
 * });
 *
 * const result = query({
 *   prompt: "What's the weather in Tokyo?",
 *   options: {
 *     mcpServers: {
 *       weather: server
 *     }
 *   }
 * });
 * ```
 */
declare function createSdkMcpServer(options: CreateSdkMcpServerOptions): McpSdkServerConfigWithInstance;

/**
 * Standalone telemetry tracker utility
 */

/**
 * TelemetryTracker provides a generic method for tracking events.
 *
 * @example
 * ```typescript
 * const tracker = new TelemetryTracker(queryHandler);
 * await tracker.track({
 *   event_type: 'like',
 *   session_id: 'session-123',
 *   message_id: 'msg-456',
 * });
 * ```
 */
declare class TelemetryTracker {
    private queryHandler;
    constructor(queryHandler: QueryHandler);
    /**
     * Send a generic tracking event
     */
    track(event: TrackingEvent): Promise<TrackingResponse>;
}

/**
 * Error types for Qoder Agent SDK
 */
/**
 * Base exception for all Qoder SDK errors
 */
declare class QoderAgentSDKError extends Error {
    constructor(message: string);
}
/**
 * Raised when unable to connect to Qoder
 */
declare class CLIConnectionError extends QoderAgentSDKError {
    constructor(message?: string);
}
/**
 * Raised when Qoder is not found or not installed
 */
declare class CLINotFoundError extends CLIConnectionError {
    readonly cliPath?: string;
    constructor(message?: string, cliPath?: string);
}
/**
 * Raised when the CLI process fails
 */
declare class ProcessError extends QoderAgentSDKError {
    readonly exitCode?: number;
    readonly stderr?: string;
    constructor(message: string, exitCode?: number, stderr?: string);
}
/**
 * Raised when unable to decode JSON from CLI output
 */
declare class CLIJSONDecodeError extends QoderAgentSDKError {
    readonly line: string;
    readonly originalError: Error;
    constructor(line: string, originalError: Error);
}
/**
 * Raised when unable to parse a message from CLI output
 */
declare class MessageParseError extends QoderAgentSDKError {
    readonly data?: Record<string, unknown>;
    constructor(message: string, data?: Record<string, unknown>);
}
/**
 * Raised when a control request times out
 */
declare class ControlRequestTimeoutError extends QoderAgentSDKError {
    readonly subtype: string;
    constructor(subtype: string);
}

export { type APIAssistantMessage, type APIUserMessage, AbortError, type AccountInfo, type AdditionalFolderContent, type AgentDefinition, type AgentInput, type ApiKeySource, type AskUserQuestionInput, type AskUserQuestionOutput, type AssistantMessageContent, type AsyncHookJSONOutput, type BaseHookInput, type BashInput, type BashOutputInput, type BashOutputToolOutput, type BashToolOutput, CLIConnectionError, CLIJSONDecodeError, CLINotFoundError, type CallToolResult, type CanUseTool, type CaseSubmitEnabledResult, type ConfigScope, ControlRequestTimeoutError, type CreateSdkMcpServerOptions, type Dict, type EditOutput, type ExitPlanModeInput, type ExitPlanModeOutput, type ExitReason, type FeedbackResult, type FileEditInput, type FileReadInput, type FileWriteInput, type GetModelsOptions, type GlobInput, type GlobOutput, type GrepContentOutput, type GrepCountOutput, type GrepFilesOutput, type GrepInput, type GrepOutput, type HookCallback, type HookCallbackMatcher, type HookEvent, type HookInput, type HookJSONOutput, type ILogger, type ImageContent, type ImageFileOutput, IntegrationMode, type IsConnectableOptions, type JSONSchema, type KillBashOutput, type KillShellInput, type ListMcpResourcesInput, type ListMcpResourcesOutput, LogLevel, type LoggerConfig, type LoginResult, type LogoutResult, type McpHttpServerConfig, type McpSSEServerConfig, type McpSdkServerConfigWithInstance, type McpServer, type McpServerConfig, type McpServerStatus, type McpStdioServerConfig, type McpToolResultContent, MessageParseError, type ModelConfig, type ModelInfo, type ModelUsage, type ModelsResult, type NetworkSandboxSettings, type NonNullableUsage, type NotebookEditInput, type NotebookEditOutput, type NotebookFileOutput, type NotificationHookInput, type Options, type OutputFormatConfig, type PDFFileOutput, type PermissionBehavior, type PermissionMode, type PermissionRequestHookInput, type PermissionResult, type PermissionResultAllow, type PermissionResultDeny, type PermissionRuleValue, type PermissionUpdate, type PermissionUpdateDestination, type PostToolUseFailureHookInput, type PostToolUseHookInput, type PostToolUseHookSpecificOutput, type PreCompactHookInput, type PreToolUseHookInput, type PreToolUseHookSpecificOutput, ProcessError, QoderAgentSDKClient, QoderAgentSDKError, type QoderWorkAccessResult, type Query, type QueryParams, type RawMessageStreamEvent, type ReadMcpResourceInput, type ReadMcpResourceOutput, type ReadOutput, type SDKAssistantMessage, type SDKCompactBoundaryMessage, type SDKConfig, type SDKMessage, type SDKPartialAssistantMessage, type SDKPermissionDenial, type SDKResultMessage, type SDKResultMessageError, type SDKResultMessageSuccess, type SDKSystemMessage, type SDKUserMessage, type SDKUserMessageReplay, type SandboxIgnoreViolations, type SandboxSettings, type SdkBeta, type SdkMcpToolDefinition, type SdkPluginConfig, type SessionEndHookInput, type SessionStartHookInput, type SessionStartHookSpecificOutput, type SettingSource, type SlashCommand, type StartLoginResult, type StatusInfo, type StopHookInput, type SubagentStartHookInput, type SubagentStopHookInput, type SubmitFeedbackOptions, type SubmitFeedbackParams, SubprocessTransport, type SubprocessTransportOptions, type SyncHookJSONOutput, type SystemPromptConfig, type TaskOutput, TcpTransport, type TcpTransportOptions, TelemetryTracker, type TextContent, type TextFileOutput, type ThinkingContent, type TodoWriteInput, type TodoWriteOutput, type ToolInput, type ToolOutput, type ToolPermissionContext, type ToolResultContent, type ToolUseContent, type ToolsConfig, type TrackingEvent, type TrackingResponse, type Transport, type UUID, type Usage, type UsageInfo, type UserMessageContent, type UserPromptSubmitHookInput, type UserPromptSubmitHookSpecificOutput, type UserQuota, VERSION, type WebFetchInput, type WebFetchOutput, type WebSearchInput, type WebSearchOutput, type WriteOutput, configure, configureLogger, createSdkMcpServer, isConnectable, logger, query, submitFeedback, tool };
