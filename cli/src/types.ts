export type Mode = "all" | "structural" | "integration" | "response-log" | "lint";
export type AuthMode = "api" | "oauth";

export function modeFlags(mode: Mode) {
    return {
        showStructural: mode === "all" || mode === "structural",
        showIntegration: mode === "all" || mode === "integration",
        showResponseLog: mode === "response-log",
    };
}

export type ReportType = "html" | "md" | "json";

export interface CliOptions {
    mode: Mode;
    target: string;
    components: string[];
    skip: string;
    model: string;
    maxTurns: number;
    timeout: number;
    verbose: boolean;
    dryRun: boolean;
    stopOnFail: boolean;
    auth: AuthMode;
    report: boolean;
    reportType: ReportType;
    reportDir: string;
    reportOpen: boolean;
    promptsFile: string;
    json: boolean;
    ci: boolean;
    maxDescLength: number;
    disable: string[];
    configFile: string;
}

export type StructuralVerdict = "pass" | "fail" | "warn" | "skip";

export type ComponentType = "manifest" | "skill" | "command" | "agent" | "hook" | "unknown";

export interface StructuralResult {
    id: number;
    verdict: StructuralVerdict;
    label: string;
    detail: string;
    component: ComponentType;
}

export type IntegrationVerdict = "pass" | "warn" | "fail" | "error" | "skip";

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
}

export interface IntegrationResult {
    testId: string;
    plugin: string;
    name: string;
    type: string;
    trigger: string;
    verdict: IntegrationVerdict;
    detail: string;
    costUsd: number;
    tokens: TokenUsage | null;
}

export type Phase = "idle" | "discovery" | "structural" | "integration" | "response-log" | "done";

export interface DiscoveryPlugin {
    name: string;
    type: string; // "plugin" | "project" | "standalone"
    skills: number;
    commands: number;
    agents: number;
    hooks: number;
}

export interface DiscoveryResult {
    plugins: DiscoveryPlugin[];
    totalCases: number;
}

// Response Log types
export interface ResponseLogExpect {
    responseContains?: string[];
    responseNotContains?: string[];
}

export interface ResponseLogPrompt {
    id: string;
    component: "skill" | "command" | "agent";
    name: string;
    prompt: string;
    expect?: ResponseLogExpect;
}

export interface ExpectationResult {
    expected: unknown;
    actual?: unknown;
    missing?: string[];
    found?: string[];
    pass: boolean;
}

export interface ResponseLogResult {
    id: string;
    plugin: string;
    component: string;
    name: string;
    prompt: string;
    verdict: IntegrationVerdict;
    verdictDetail: string;
    response: string;
    responsePreview: string;
    expectations: Record<string, ExpectationResult>;
    costUsd: number;
    tokens: TokenUsage | null;
    durationMs: number;
}
