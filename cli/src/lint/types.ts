export type Severity = "error" | "warning" | "info";

export interface LintResult {
    rule: string;
    severity: Severity;
    message: string;
    file?: string;
    detail?: string;
}

export interface LintScanned {
    skills: number;
    commands: number;
    agents: number;
    hooks: number;
    manifest: boolean;
}

export interface LintSummary {
    target: string;
    errors: number;
    warnings: number;
    infos: number;
    passed: boolean;
    results: LintResult[];
    scanned: LintScanned;
}

export interface LintOptions {
    /** Only check specific components */
    components?: ("skills" | "commands" | "agents" | "hooks")[];
    /** Include passing checks (info level) */
    verbose?: boolean;
    /** Max description length in characters (default: 1024) */
    maxDescLength?: number;
    /** Rule IDs to disable */
    disable?: string[];
}

// Hook schema types
export interface HookEntry {
    type?: string;
    command?: string;
    prompt?: string;
    matcher?: string;
    hooks?: HookEntry[];
}

export interface HooksConfig {
    hooks?: Record<string, HookEntry[]>;
}
