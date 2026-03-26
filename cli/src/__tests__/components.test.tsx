import { describe, it, expect } from "@jest/globals";
import React from "react";
import { render } from "ink-testing-library";
import { Header } from "../components/Header.js";
import { TabBar } from "../components/TabBar.js";
import { StreamLine } from "../components/StreamLine.js";
import { VERDICT_ICONS } from "../verdicts.js";
import type { StreamItem } from "../components/StreamLine.js";
import { C } from "../theme.js";
import { makeOpts } from "./test-helpers.js";

// ── Header ────────────────────────────────────────────────────────────

describe("Header", () => {
    it("renders conform title", () => {
        const { lastFrame } = render(<Header opts={makeOpts()} />);
        expect(lastFrame()).toContain("conform");
    });

    it("shows mode label for 'all'", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ mode: "all" })} />);
        expect(lastFrame()).toContain("all");
    });

    it("shows mode label for 'structural'", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ mode: "structural" })} />);
        expect(lastFrame()).toContain("structural");
    });

    it("shows mode label for 'integration'", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ mode: "integration" })} />);
        expect(lastFrame()).toContain("integration");
    });

    it("shows model name", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ model: "sonnet" })} />);
        expect(lastFrame()).toContain("sonnet");
    });

    it("shows target path (last 2 segments)", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ target: "/a/b/c/my-plugin" })} />);
        expect(lastFrame()).toContain("c/my-plugin");
    });

    it("shows DRY RUN indicator when enabled", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ dryRun: true })} />);
        expect(lastFrame()).toContain("DRY RUN");
    });

    it("does not show DRY RUN when disabled", () => {
        const { lastFrame } = render(<Header opts={makeOpts({ dryRun: false })} />);
        expect(lastFrame()).not.toContain("DRY RUN");
    });
});

// ── TabBar ────────────────────────────────────────────────────────────

describe("TabBar", () => {
    it("renders all three tabs", () => {
        const { lastFrame } = render(<TabBar active="log" issueCount={0} />);
        const frame = lastFrame()!;
        expect(frame).toContain("Log");
        expect(frame).toContain("Summary");
        expect(frame).toContain("Results");
    });

    it("highlights active tab with arrow indicator", () => {
        const { lastFrame } = render(<TabBar active="summary" issueCount={0} />);
        const frame = lastFrame()!;
        // Active tab gets ▸ prefix
        expect(frame).toContain("▸ Summary");
    });

    it("shows issue count on Results tab", () => {
        const { lastFrame } = render(<TabBar active="log" issueCount={5} />);
        expect(lastFrame()).toContain("Results(5)");
    });

    it("does not show count when issues is 0", () => {
        const { lastFrame } = render(<TabBar active="log" issueCount={0} />);
        expect(lastFrame()).not.toContain("Results(");
        expect(lastFrame()).toContain("Results");
    });

    it("renders tab separators", () => {
        const { lastFrame } = render(<TabBar active="log" issueCount={0} />);
        expect(lastFrame()).toContain("│");
    });
});

// ── StreamLine ────────────────────────────────────────────────────────

describe("StreamLine", () => {
    it("renders divider type", () => {
        const item: StreamItem = { id: "d1", type: "divider", text: "" };
        const { lastFrame } = render(<StreamLine item={item} />);
        expect(lastFrame()).toContain("───");
    });

    it("renders section type", () => {
        const item: StreamItem = {
            id: "s1",
            type: "section",
            text: "▸ Structural Tests",
            color: C.cyan,
            bold: true,
        };
        const { lastFrame } = render(<StreamLine item={item} />);
        expect(lastFrame()).toContain("Structural Tests");
    });

    it("renders detail type", () => {
        const item: StreamItem = {
            id: "dt1",
            type: "detail",
            text: "↳ Missing or empty",
            color: C.dimText,
        };
        const { lastFrame } = render(<StreamLine item={item} />);
        expect(lastFrame()).toContain("Missing or empty");
    });

    it("renders summary type", () => {
        const item: StreamItem = {
            id: "sum1",
            type: "summary",
            text: "36 passed, 0 failed",
            color: C.green,
        };
        const { lastFrame } = render(<StreamLine item={item} />);
        expect(lastFrame()).toContain("36 passed, 0 failed");
    });

    it("renders result type with icon", () => {
        const item: StreamItem = {
            id: "r1",
            type: "result",
            text: "my-plugin: plugin.json exists",
            icon: "✔",
            iconColor: C.green,
        };
        const { lastFrame } = render(<StreamLine item={item} />);
        const frame = lastFrame()!;
        expect(frame).toContain("✔");
        expect(frame).toContain("plugin.json exists");
    });
});

// ── ResultsView ──────────────────────────────────────────────────────

import { buildResultLines } from "../components/ResultsView.js";
import type { IntegrationResult, StructuralResult } from "../types.js";

describe("buildResultLines", () => {
    it("formats wrong-skill-loaded warns with loaded/expected detail", () => {
        const intResults: IntegrationResult[] = [
            {
                testId: "my-plugin/data-analysis",
                plugin: "my-plugin",
                name: "data-analysis",
                type: "skill",
                trigger: "analyze data",
                verdict: "warn",
                detail: 'loaded: data-analytics (expected: data-analysis) | trigger: "analyze data"',
                costUsd: 0,
                tokens: null,
            },
        ];
        const lines = buildResultLines([], intResults);
        const allText = lines.map((l) => l.text).join("\n");
        expect(allText).toContain("Integration Warnings");
        expect(allText).toContain("loaded: data-analytics");
        expect(allText).toContain("expected: data-analysis");
        expect(allText).toContain("[skill]");
    });

    it("includes type tags for integration failures", () => {
        const intResults: IntegrationResult[] = [
            {
                testId: "my-plugin/cmd:deploy",
                plugin: "my-plugin",
                name: "cmd:deploy",
                type: "command",
                trigger: "deploy",
                verdict: "fail",
                detail: "Command not found",
                costUsd: 0,
                tokens: null,
            },
        ];
        const lines = buildResultLines([], intResults);
        const allText = lines.map((l) => l.text).join("\n");
        expect(allText).toContain("[command]");
        expect(allText).toContain("my-plugin/cmd:deploy");
    });

    it("shows all clear when no issues", () => {
        const structResults: StructuralResult[] = [
            { id: 1, verdict: "pass", label: "test passes", detail: "", component: "skill" },
        ];
        const lines = buildResultLines(structResults, []);
        const allText = lines.map((l) => l.text).join("\n");
        expect(allText).toContain("All clear");
    });
});

// ── Icon maps ─────────────────────────────────────────────────────────

describe("VERDICT_ICONS", () => {
    it("has all verdict types with correct icons and colors", () => {
        expect(VERDICT_ICONS.pass).toEqual({ icon: "✔", color: C.green });
        expect(VERDICT_ICONS.fail).toEqual({ icon: "✘", color: C.red });
        expect(VERDICT_ICONS.warn).toEqual({ icon: "!", color: C.yellow });
        expect(VERDICT_ICONS.skip).toEqual({ icon: "⊘", color: C.dimText });
        expect(VERDICT_ICONS.error).toEqual({ icon: "✘", color: C.red });
    });
});
