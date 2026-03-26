import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import { DIVIDER, countStructVerdicts, countIntVerdicts } from "../verdicts.js";
import type {
    StructuralResult,
    IntegrationResult,
    Phase,
    TokenUsage,
    ComponentType,
} from "../types.js";

const TYPE_COLORS: Partial<Record<ComponentType, string>> = {
    skill: C.cyan,
    command: C.magenta,
    agent: C.purple,
    hook: C.yellow,
};

function inferIntComponentType(r: IntegrationResult): ComponentType {
    if (r.type === "command") return "command";
    if (r.type === "hook") return "hook";
    if (r.type === "agent" || r.name.startsWith("agent:")) return "agent";
    return "skill";
}

interface TypeCounts {
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    total: number;
}

function countByType(
    structural: StructuralResult[],
    integration: IntegrationResult[],
): Map<ComponentType, TypeCounts> {
    const map = new Map<ComponentType, TypeCounts>();

    function ensure(t: ComponentType): TypeCounts {
        let counts = map.get(t);
        if (!counts) {
            counts = { passed: 0, failed: 0, warned: 0, skipped: 0, total: 0 };
            map.set(t, counts);
        }
        return counts;
    }

    for (const r of structural) {
        // skip manifest/unknown from the type breakdown — they aren't meaningful types
        if (r.component === "manifest" || r.component === "unknown") continue;
        const c = ensure(r.component);
        c.total++;
        if (r.verdict === "pass") c.passed++;
        else if (r.verdict === "fail") c.failed++;
        else if (r.verdict === "warn") c.warned++;
        else if (r.verdict === "skip") c.skipped++;
    }

    for (const r of integration) {
        const t = inferIntComponentType(r);
        if (t === "manifest" || t === "unknown") continue;
        const c = ensure(t);
        c.total++;
        if (r.verdict === "pass") c.passed++;
        else if (r.verdict === "fail" || r.verdict === "error") c.failed++;
        else if (r.verdict === "warn") c.warned++;
        else if (r.verdict === "skip") c.skipped++;
    }

    return map;
}

interface MisloadEntry {
    testId: string;
    trigger: string;
    loaded: string;
    expected: string;
    type: ComponentType;
}

function parseMisloads(integration: IntegrationResult[]): MisloadEntry[] {
    const entries: MisloadEntry[] = [];
    const loadedRe = /loaded:\s*(\S+)\s*\(expected:\s*(\S+)\)/;
    for (const r of integration) {
        if (r.verdict !== "warn") continue;
        const m = loadedRe.exec(r.detail);
        if (!m) continue;
        entries.push({
            testId: r.testId,
            trigger: r.trigger,
            loaded: m[1],
            expected: m[2],
            type: inferIntComponentType(r),
        });
    }
    return entries;
}

function MisloadSummary({ integration }: Readonly<{ integration: IntegrationResult[] }>) {
    const misloads = parseMisloads(integration);
    if (misloads.length === 0) return null;

    return (
        <Box flexDirection="column">
            <Box gap={2}>
                <Text color={C.yellow} bold>
                    ▸ Wrong Component Loaded ({misloads.length})
                </Text>
            </Box>
            {misloads.map((e) => (
                <Box key={e.testId} paddingLeft={2} flexDirection="column">
                    <Box gap={1}>
                        <Text color={C.yellow}>!</Text>
                        <Text color={TYPE_COLORS[e.type] ?? C.dimText}>[{e.type}]</Text>
                        <Text color={C.white}>{e.testId}</Text>
                    </Box>
                    <Box paddingLeft={4} gap={1}>
                        <Text color={C.dimText}>trigger:</Text>
                        <Text color={C.white}>{`"${e.trigger}"`}</Text>
                    </Box>
                    <Box paddingLeft={4} gap={1}>
                        <Text color={C.dimText}>loaded:</Text>
                        <Text color={C.white}>{e.loaded}</Text>
                        <Text color={C.dimText}>→ expected:</Text>
                        <Text color={C.purple}>{e.expected}</Text>
                    </Box>
                </Box>
            ))}
            <Text> </Text>
        </Box>
    );
}

function TypeBreakdown({
    structural,
    integration,
}: Readonly<{ structural: StructuralResult[]; integration: IntegrationResult[] }>) {
    const byType = countByType(structural, integration);
    if (byType.size === 0) return null;

    // Sort: skill, command, agent, hook
    const order: ComponentType[] = ["skill", "command", "agent", "hook"];
    const entries = order
        .filter((t) => byType.has(t))
        .map((t) => {
            const counts = byType.get(t) as TypeCounts;
            return { type: t, ...counts };
        });

    if (entries.length === 0) return null;

    const colW = { type: 9, pass: 6, fail: 6, warn: 6, skip: 6 };
    const header = `${"Type".padEnd(colW.type)}${"Pass".padStart(colW.pass)}${"Fail".padStart(colW.fail)}${"Warn".padStart(colW.warn)}${"Skip".padStart(colW.skip)}`;
    const rule = "─".repeat(header.length);

    return (
        <Box flexDirection="column" paddingLeft={2}>
            <Text color={C.dimText}>{header}</Text>
            <Text color={C.dim}>{rule}</Text>
            {entries.map((e) => (
                <Box key={e.type}>
                    <Text color={TYPE_COLORS[e.type] ?? C.dimText}>{e.type.padEnd(colW.type)}</Text>
                    <Text color={e.passed > 0 ? C.green : C.dim}>
                        {String(e.passed).padStart(colW.pass)}
                    </Text>
                    <Text color={e.failed > 0 ? C.red : C.dim}>
                        {String(e.failed).padStart(colW.fail)}
                    </Text>
                    <Text color={e.warned > 0 ? C.yellow : C.dim}>
                        {String(e.warned).padStart(colW.warn)}
                    </Text>
                    <Text color={e.skipped > 0 ? C.dimText : C.dim}>
                        {String(e.skipped).padStart(colW.skip)}
                    </Text>
                </Box>
            ))}
        </Box>
    );
}

interface SummaryViewProps {
    phase: Phase;
    structural: StructuralResult[];
    integration: IntegrationResult[];
    showStructural: boolean;
    showIntegration: boolean;
    visibleHeight: number;
}

function rateColor(pct: number): string {
    if (pct >= 95) return C.green;
    if (pct >= 80) return C.yellow;
    return C.red;
}

const BAR_WIDTH = 40;

function ProgressBar({
    passed,
    failed,
    warned,
    skipped,
    total,
}: Readonly<{
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    total: number;
}>) {
    if (total === 0) return null;
    const pPass = Math.round((passed / total) * BAR_WIDTH);
    const pFail = Math.round((failed / total) * BAR_WIDTH);
    const pWarn = Math.round((warned / total) * BAR_WIDTH);
    const pSkip = Math.round((skipped / total) * BAR_WIDTH);
    const pEmpty = Math.max(0, BAR_WIDTH - pPass - pFail - pWarn - pSkip);

    return (
        <Box>
            <Text color={C.green}>{"█".repeat(pPass)}</Text>
            <Text color={C.red}>{"█".repeat(pFail)}</Text>
            <Text color={C.yellow}>{"█".repeat(pWarn)}</Text>
            <Text color={C.dimText}>{"█".repeat(pSkip)}</Text>
            <Text color={C.dim}>{"░".repeat(pEmpty)}</Text>
        </Box>
    );
}

function SectionSummary({
    label,
    passed,
    failed,
    warned,
    skipped,
    total,
}: Readonly<{
    label: string;
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    total: number;
}>) {
    const pct = total > 0 ? ((passed / total) * 100).toFixed(0) : "0";

    return (
        <Box flexDirection="column">
            <Box gap={2}>
                <Text color={C.purple} bold>
                    ▸ {label}
                </Text>
                <Text color={C.dimText}>{total} tests</Text>
            </Box>
            <Box paddingLeft={2} gap={1}>
                <ProgressBar
                    passed={passed}
                    failed={failed}
                    warned={warned}
                    skipped={skipped}
                    total={total}
                />
                <Text color={rateColor(parseFloat(pct))} bold>
                    {pct}%
                </Text>
            </Box>
            <Box paddingLeft={2} gap={2}>
                <Text color={C.green}>✔ {passed}</Text>
                <Text color={failed > 0 ? C.red : C.dim}>✘ {failed}</Text>
                <Text color={warned > 0 ? C.yellow : C.dim}>! {warned}</Text>
                <Text color={C.dim}>⊘ {skipped}</Text>
            </Box>
        </Box>
    );
}

export function SummaryView({
    phase,
    structural,
    integration,
    showStructural,
    showIntegration,
    visibleHeight,
}: Readonly<SummaryViewProps>) {
    const sc = countStructVerdicts(structural);
    const ic = countIntVerdicts(integration);

    const totalPassed = sc.passed + ic.passed;
    const totalFailed = sc.failed + ic.failed;
    const totalWarns = sc.warned + ic.warned;
    const totalSkipped = sc.skipped + ic.skipped;
    const totalTests = totalPassed + totalFailed + totalWarns + totalSkipped;
    const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : "0.0";

    // Aggregate token usage from integration results
    const totalCost = integration.reduce((sum, r) => sum + (r.costUsd || 0), 0);
    const hasTokenData = integration.some((r) => r.tokens !== null);
    const totalTokens: TokenUsage = {
        inputTokens: integration.reduce((sum, r) => sum + (r.tokens?.inputTokens ?? 0), 0),
        outputTokens: integration.reduce((sum, r) => sum + (r.tokens?.outputTokens ?? 0), 0),
        cacheReadInputTokens: integration.reduce(
            (sum, r) => sum + (r.tokens?.cacheReadInputTokens ?? 0),
            0,
        ),
        cacheCreationInputTokens: integration.reduce(
            (sum, r) => sum + (r.tokens?.cacheCreationInputTokens ?? 0),
            0,
        ),
    };

    const isRunning = phase !== "done";

    return (
        <Box flexDirection="column" height={visibleHeight} paddingLeft={1} paddingTop={1}>
            {isRunning && (
                <>
                    <Text color={C.dimText}>Tests still running…</Text>
                    <Text> </Text>
                </>
            )}

            {/* Overall pass rate bar */}
            <Box flexDirection="column">
                <Box gap={1}>
                    <Text color={C.dimText}>PASS RATE</Text>
                    <Text color={rateColor(parseFloat(passRate))} bold>
                        {passRate}%
                    </Text>
                </Box>
                <Box paddingLeft={0}>
                    <ProgressBar
                        passed={totalPassed}
                        failed={totalFailed}
                        warned={totalWarns}
                        skipped={totalSkipped}
                        total={totalTests}
                    />
                </Box>
            </Box>

            <Text> </Text>

            {/* Per-section breakdowns */}
            {showStructural && sc.total > 0 && (
                <>
                    <SectionSummary
                        label="Structural"
                        passed={sc.passed}
                        failed={sc.failed}
                        warned={sc.warned}
                        skipped={sc.skipped}
                        total={sc.total}
                    />
                    <Text> </Text>
                </>
            )}

            {showIntegration && ic.total > 0 && (
                <>
                    <SectionSummary
                        label="Integration"
                        passed={ic.passed}
                        failed={ic.failed}
                        warned={ic.warned}
                        skipped={ic.skipped}
                        total={ic.total}
                    />
                    <Text> </Text>
                </>
            )}

            {/* Type breakdown table */}
            {(structural.length > 0 || integration.length > 0) && (
                <>
                    <Box gap={2}>
                        <Text color={C.purple} bold>
                            ▸ By Type
                        </Text>
                    </Box>
                    <TypeBreakdown structural={structural} integration={integration} />
                    <Text> </Text>
                </>
            )}

            {/* Wrong component loaded warnings */}
            <MisloadSummary integration={integration} />

            {/* Totals */}
            <Text color={C.dim}>{DIVIDER}</Text>
            <Text> </Text>
            <Box gap={2}>
                <Text color={C.green} bold>
                    ✔ {totalPassed} passed
                </Text>
                {totalFailed > 0 && (
                    <Text color={C.red} bold>
                        ✘ {totalFailed} failed
                    </Text>
                )}
                {totalWarns > 0 && <Text color={C.yellow}>! {totalWarns} warnings</Text>}
                {totalSkipped > 0 && <Text color={C.dimText}>⊘ {totalSkipped} skipped</Text>}
            </Box>

            {/* Token usage (integration tests) */}
            {hasTokenData && (
                <>
                    <Text> </Text>
                    <Box flexDirection="column">
                        <Box gap={2}>
                            <Text color={C.purple} bold>
                                ▸ Token Usage
                            </Text>
                            {totalCost > 0 && (
                                <Text color={C.dimText}>
                                    ${totalCost < 0.001 ? "<0.001" : totalCost.toFixed(4)}
                                </Text>
                            )}
                        </Box>
                        <Box paddingLeft={2} flexDirection="column">
                            <Box gap={1}>
                                <Text color={C.dimText}>Input:</Text>
                                <Text color={C.white}>
                                    {totalTokens.inputTokens.toLocaleString()}
                                </Text>
                                {totalTokens.cacheReadInputTokens > 0 && (
                                    <Text color={C.dimText}>
                                        (cache read:{" "}
                                        {totalTokens.cacheReadInputTokens.toLocaleString()})
                                    </Text>
                                )}
                                {totalTokens.cacheCreationInputTokens > 0 && (
                                    <Text color={C.dimText}>
                                        (cache write:{" "}
                                        {totalTokens.cacheCreationInputTokens.toLocaleString()})
                                    </Text>
                                )}
                            </Box>
                            <Box gap={1}>
                                <Text color={C.dimText}>Output:</Text>
                                <Text color={C.white}>
                                    {totalTokens.outputTokens.toLocaleString()}
                                </Text>
                            </Box>
                        </Box>
                    </Box>
                </>
            )}

            <Text> </Text>
            <Text bold color={totalFailed === 0 ? C.green : C.red}>
                ◆ RESULT: {totalFailed === 0 ? "PASS" : "FAIL"}
            </Text>
        </Box>
    );
}
