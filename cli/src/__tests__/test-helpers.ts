import type { CliOptions } from "../types.js";

export function makeOpts(overrides: Partial<CliOptions> = {}): CliOptions {
    return {
        mode: "all",
        target: "./test-plugin",
        components: ["skills", "commands", "agents", "hooks"],
        skip: "",
        model: "haiku",
        maxTurns: 5,
        timeout: 60,
        verbose: false,
        dryRun: false,
        stopOnFail: false,
        auth: "oauth",
        report: false,
        reportType: "html",
        reportDir: "./reports",
        reportOpen: false,
        promptsFile: "",
        json: false,
        ci: false,
        maxDescLength: 1024,
        disable: [],
        configFile: "",
        ...overrides,
    };
}
