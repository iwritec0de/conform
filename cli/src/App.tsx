import { execFile } from "node:child_process";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useScrollable } from "./hooks/useScrollable.js";
import { useBatchedState } from "./hooks/useBatchedState.js";
import { Header } from "./components/Header.js";
import { TabBar, type TabId } from "./components/TabBar.js";
import { LogView } from "./components/LogView.js";
import { SummaryView } from "./components/SummaryView.js";
import { ResultsView, buildResultLines } from "./components/ResultsView.js";
import { StatusBar } from "./components/StatusBar.js";
import { SlowSpinner } from "./components/SlowSpinner.js";
import { StreamLine } from "./components/StreamLine.js";
import type { StreamItem } from "./components/StreamLine.js";
import { discoverPlugins, runStructural, runIntegration } from "./runners.js";
import { runResponseLog } from "./response-log.js";
import { writeReport } from "./report.js";
import { C } from "./theme.js";
import {
    VERDICT_ICONS,
    countStructVerdicts,
    countIntVerdicts,
    buildSummaryText,
    buildSummarySegments,
} from "./verdicts.js";
import {
    modeFlags,
    type CliOptions,
    type Phase,
    type StructuralResult,
    type IntegrationResult,
    type ResponseLogResult,
    type ComponentType,
} from "./types.js";

const CHROME_LINES = 7;

function formatElapsed(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

const COMPONENT_TAG_COLOR: Record<ComponentType, string> = {
    manifest: C.dimText,
    skill: C.cyan,
    command: C.magenta,
    agent: C.purple,
    hook: C.yellow,
    unknown: C.dimText,
};

function componentTag(
    comp: ComponentType,
): { tag: string; tagColor: string } | Record<string, never> {
    if (!comp || comp === "unknown") return {};
    return { tag: `[${comp}]`, tagColor: COMPONENT_TAG_COLOR[comp] };
}

function inferIntComponentType(r: IntegrationResult): ComponentType {
    if (r.type === "command") return "command";
    if (r.type === "hook") return "hook";
    if (r.type === "agent" || r.name.startsWith("agent:")) return "agent";
    return "skill";
}

function resolveComponentType(component: string): ComponentType {
    if (component === "command") return "command";
    if (component === "hook") return "hook";
    if (component === "agent") return "agent";
    return "skill";
}
/** Build stream lines for new structural results since prevLen. Mutates streamIdRef. */
function buildStructuralStreamLines(
    structResults: StructuralResult[],
    prevLen: number,
    streamIdRef: React.RefObject<number>,
): StreamItem[] {
    const lines: StreamItem[] = [];
    const newResults = structResults.slice(prevLen);
    for (const r of newResults) {
        const v = VERDICT_ICONS[r.verdict] || VERDICT_ICONS.pass;
        lines.push({
            id: `sr-${streamIdRef.current++}`,
            type: "result",
            text: r.label,
            icon: v.icon,
            iconColor: v.color,
            ...componentTag(r.component),
        });
        if (r.detail) {
            lines.push({
                id: `sd-${streamIdRef.current++}`,
                type: "detail",
                text: `↳ ${r.detail}`,
                color: v.color,
            });
        }
    }
    return lines;
}

/** Build the structural summary + divider once structural finishes. Mutates streamIdRef. */
function buildStructuralSummary(
    structResults: StructuralResult[],
    streamIdRef: React.RefObject<number>,
): StreamItem[] {
    const lines: StreamItem[] = [];
    const counts = countStructVerdicts(structResults);
    lines.push({
        id: `ss-${streamIdRef.current++}`,
        type: "summary",
        text: buildSummaryText(counts, { showTotal: true }),
        color: counts.failed > 0 ? C.red : C.green,
        segments: buildSummarySegments(counts, { showTotal: true }),
    });
    lines.push({
        id: `div-${streamIdRef.current++}`,
        type: "divider",
        text: "",
    });
    return lines;
}

/** Build stream lines for new integration results since prevLen. Mutates streamIdRef. */
function buildIntegrationStreamLines(
    intResults: IntegrationResult[],
    prevLen: number,
    intTotal: number,
    streamIdRef: React.RefObject<number>,
): StreamItem[] {
    const lines: StreamItem[] = [];
    const total = Math.max(intTotal, intResults.length);
    for (let i = prevLen; i < intResults.length; i++) {
        const r = intResults[i];
        const v = VERDICT_ICONS[r.verdict] || VERDICT_ICONS.pass;
        const progress = total > 0 ? `[${i + 1}/${total}]` : `[${i + 1}]`;
        const triggerSuffix = r.trigger ? ` "${r.trigger}"` : "";
        const intComp = inferIntComponentType(r);
        lines.push({
            id: `ir-${streamIdRef.current++}`,
            type: "result",
            text: `${progress} ${r.testId}${triggerSuffix}`,
            icon: v.icon,
            iconColor: v.color,
            ...componentTag(intComp),
        });
        if (r.detail && (r.verdict === "fail" || r.verdict === "error" || r.verdict === "warn")) {
            lines.push({
                id: `id-${streamIdRef.current++}`,
                type: "detail",
                text: `↳ ${r.detail}`,
                color: v.color,
            });
        }
    }
    return lines;
}

/** Build stream lines for new response-log results since prevLen. Mutates streamIdRef. */
function buildResponseLogStreamLines(
    rlResults: ResponseLogResult[],
    prevLen: number,
    rlTotal: number,
    streamIdRef: React.RefObject<number>,
): StreamItem[] {
    const lines: StreamItem[] = [];
    const total = Math.max(rlTotal, rlResults.length);
    for (let i = prevLen; i < rlResults.length; i++) {
        const r = rlResults[i];
        const v = VERDICT_ICONS[r.verdict] || VERDICT_ICONS.pass;
        const progress = total > 0 ? `[${i + 1}/${total}]` : `[${i + 1}]`;
        const truncPrompt = r.prompt.length > 60 ? r.prompt.slice(0, 57) + "..." : r.prompt;
        const rlComp = resolveComponentType(r.component);
        lines.push({
            id: `rl-${streamIdRef.current++}`,
            type: "result",
            text: `${progress} ${r.plugin}/${r.name} "${truncPrompt}"`,
            icon: v.icon,
            iconColor: v.color,
            ...componentTag(rlComp),
        });

        // Always show expectation summary so it's clear what was checked
        const expKeys = Object.keys(r.expectations);
        if (expKeys.length > 0) {
            const parts = expKeys.map((k) => {
                const e = r.expectations[k];
                return e.pass ? `${k} ✓` : `${k} ✗`;
            });
            const detailColor = r.verdict === "pass" ? "gray" : v.color;
            lines.push({
                id: `rd-${streamIdRef.current++}`,
                type: "detail",
                text: `↳ ${parts.join(", ")}`,
                color: detailColor,
            });
        } else if (r.verdict !== "skip") {
            lines.push({
                id: `rd-${streamIdRef.current++}`,
                type: "detail",
                text: "↳ no expectations (response-only)",
                color: "gray",
            });
        }
    }
    return lines;
}

/** Build discovery stream lines for the TUI. */
function buildDiscoveryStreamLines(
    discovery: {
        plugins: Array<{
            name: string;
            type: string;
            skills: number;
            commands: number;
            agents: number;
            hooks: number;
        }>;
        totalCases: number;
    },
    streamIdRef: React.RefObject<number>,
): StreamItem[] {
    if (discovery.plugins.length === 0) return [];

    const lines: StreamItem[] = [];
    lines.push({
        id: `disc-h-${streamIdRef.current++}`,
        type: "section",
        text: `▸ Discovery`,
        color: C.purple,
        bold: true,
    });

    const TYPE_LABELS: Record<string, string> = {
        plugin: "plugin",
        project: ".claude project",
        standalone: "standalone",
    };

    for (const p of discovery.plugins) {
        const parts: string[] = [];
        if (p.skills > 0) parts.push(`${p.skills} skill${p.skills > 1 ? "s" : ""}`);
        if (p.commands > 0) parts.push(`${p.commands} cmd${p.commands > 1 ? "s" : ""}`);
        if (p.agents > 0) parts.push(`${p.agents} agent${p.agents > 1 ? "s" : ""}`);
        if (p.hooks > 0) parts.push(`${p.hooks} hook${p.hooks > 1 ? "s" : ""}`);
        const typeLabel = TYPE_LABELS[p.type] || p.type;
        lines.push({
            id: `disc-p-${streamIdRef.current++}`,
            type: "result",
            text: `${p.name} (${typeLabel}) — ${parts.join(", ")}`,
            icon: "◆",
            iconColor: C.cyan,
        });
    }

    lines.push({
        id: `disc-s-${streamIdRef.current++}`,
        type: "detail",
        text: `${discovery.plugins.length} plugin${discovery.plugins.length > 1 ? "s" : ""} loaded`,
        color: C.dimText,
    });
    lines.push({
        id: `disc-div-${streamIdRef.current++}`,
        type: "divider",
        text: "",
    });

    return lines;
}

const IS_TTY = !!process.stdin.isTTY;
const BATCH_MS = 150;

interface AppProps {
    opts: CliOptions;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- main app component
export function App({ opts }: Readonly<AppProps>) {
    const { exit } = useApp();
    const { rows } = useTerminalSize();
    const [phase, setPhase] = useState<Phase>("idle");
    const [activeTab, setActiveTab] = useState<TabId>("results");

    // === Results state ===
    const [structResults, pushStruct, , stopStructBatch, getAllStruct] =
        useBatchedState<StructuralResult>([], BATCH_MS);
    const [structSection, setStructSection] = useState("");
    const [structRunning, setStructRunning] = useState(false);

    // Use a mutable ref to accumulate integration results, then flush to state
    // periodically. This avoids O(N²) from spread-copying on every result.
    const intResultsRef = useRef<IntegrationResult[]>([]);
    const [intResults, setIntResults] = useState<IntegrationResult[]>([]);
    const [intTotal, setIntTotal] = useState(0);
    const [intRunning, setIntRunning] = useState(false);
    const [activeTest, setActiveTest] = useState<string | null>(null);
    const [activeTrigger, setActiveTrigger] = useState<string | null>(null);

    const hasFailures = useRef(false);
    const [reportFile, setReportFile] = useState<string | null>(null);

    // === Static stream lines (for <Static> during execution) ===
    // Items accumulate in the ref. We snapshot to state only when new items
    // are added (not on every batched flush). Ink's <Static> needs a new array
    // reference to detect changes, but we only append — so we slice from the
    // previous snapshot length to avoid copying already-rendered items.
    const streamAccRef = useRef<StreamItem[]>([]);
    const [streamLines, setStreamLines] = useState<StreamItem[]>([]);
    const streamIdRef = useRef(0);

    // Response log state
    const rlResultsRef = useRef<ResponseLogResult[]>([]);
    const [rlResults, setRlResults] = useState<ResponseLogResult[]>([]);
    const [rlTotal, setRlTotal] = useState(0);
    const [rlRunning, setRlRunning] = useState(false);
    const [rlActiveId, setRlActiveId] = useState<string | null>(null);
    const [rlActivePrompt, setRlActivePrompt] = useState<string | null>(null);

    const { showStructural, showIntegration, showResponseLog } = modeFlags(opts.mode);

    // Track elapsed time — freeze when tests complete
    const startTimeRef = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (phase === "done") return;
        const timer = setInterval(() => {
            setElapsed(Date.now() - startTimeRef.current);
        }, 1000);
        return () => clearInterval(timer);
    }, [phase]);

    // Build stream lines from new results (append-only for <Static>)
    const prevStructLen = useRef(0);
    const prevIntLen = useRef(0);
    const prevRlLen = useRef(0);
    const structHeaderAdded = useRef(false);
    const structSummaryAdded = useRef(false);
    const intHeaderAdded = useRef(false);
    const rlHeaderAdded = useRef(false);

    useEffect(() => {
        const newLines: StreamItem[] = [];

        // Structural results
        if (structResults.length > prevStructLen.current) {
            if (!structHeaderAdded.current && structResults.length > 0) {
                structHeaderAdded.current = true;
                newLines.push({
                    id: `sh-${streamIdRef.current++}`,
                    type: "section",
                    text: `▸ Structural Tests`,
                    color: C.purple,
                    bold: true,
                });
            }
            newLines.push(
                ...buildStructuralStreamLines(structResults, prevStructLen.current, streamIdRef),
            );
            prevStructLen.current = structResults.length;
        }

        // Structural summary (once, when structural finishes)
        if (
            !structRunning &&
            prevStructLen.current > 0 &&
            structHeaderAdded.current &&
            !structSummaryAdded.current
        ) {
            structSummaryAdded.current = true;
            newLines.push(...buildStructuralSummary(structResults, streamIdRef));
        }

        // Integration results
        if (intResults.length > prevIntLen.current) {
            if (!intHeaderAdded.current) {
                intHeaderAdded.current = true;
                newLines.push({
                    id: `ih-${streamIdRef.current++}`,
                    type: "section",
                    text: `▸ Integration Tests`,
                    color: C.purple,
                    bold: true,
                });
            }
            newLines.push(
                ...buildIntegrationStreamLines(
                    intResults,
                    prevIntLen.current,
                    intTotal,
                    streamIdRef,
                ),
            );
            prevIntLen.current = intResults.length;
        }

        // Response log results
        if (rlResults.length > prevRlLen.current) {
            if (!rlHeaderAdded.current) {
                rlHeaderAdded.current = true;
                newLines.push({
                    id: `rh-${streamIdRef.current++}`,
                    type: "section",
                    text: `▸ Response Log`,
                    color: C.purple,
                    bold: true,
                });
            }
            newLines.push(
                ...buildResponseLogStreamLines(rlResults, prevRlLen.current, rlTotal, streamIdRef),
            );
            prevRlLen.current = rlResults.length;
        }

        if (newLines.length > 0) {
            streamAccRef.current.push(...newLines);
            setStreamLines((prev) => prev.concat(newLines));
        }
    }, [structResults, intResults, rlResults, structRunning, intTotal, opts.verbose, rlTotal]);

    // === Done phase: add integration summary to stream ===
    const addedIntSummary = useRef(false);
    useEffect(() => {
        if (phase === "done" && !addedIntSummary.current && intResults.length > 0) {
            addedIntSummary.current = true;
            const counts = countIntVerdicts(intResults);
            const summaryItem: StreamItem = {
                id: `is-${streamIdRef.current++}`,
                type: "summary" as const,
                text: buildSummaryText(counts, { showTotal: true }),
                color: counts.failed > 0 ? C.red : C.green,
                segments: buildSummarySegments(counts, { showTotal: true }),
            };
            streamAccRef.current.push(summaryItem);
            setStreamLines((prev) => [...prev, summaryItem]);
        }
    }, [phase, intResults]);

    // === Tabbed review state (only used after done) ===
    const contentHeight = Math.max(1, rows - CHROME_LINES - 1);

    const logLineCount = useMemo(() => {
        if (phase !== "done") return 0;
        let count = 0;
        if (structResults.length > 0) {
            count += 1;
            for (const r of structResults) {
                count += 1;
                if (r.detail) count += 1;
            }
            count += 2; // summary + divider
        }
        if (intResults.length > 0) {
            count += 1;
            for (const r of intResults) {
                count += 1;
                if (
                    r.detail &&
                    (r.verdict === "fail" || r.verdict === "error" || r.verdict === "warn")
                ) {
                    count += 1;
                }
            }
            count += 1; // summary
        }
        return count;
    }, [structResults, intResults, phase]);

    const resultsLineCount = useMemo(
        () => buildResultLines(structResults, intResults).length,
        [structResults, intResults],
    );

    const structCounts = countStructVerdicts(structResults);
    const intCounts = countIntVerdicts(intResults);
    const issueCount =
        structCounts.failed +
        structCounts.warned +
        structCounts.skipped +
        (intCounts.failed + intCounts.warned + intCounts.skipped);

    const logScroll = useScrollable(logLineCount, contentHeight);
    const resultsScroll = useScrollable(resultsLineCount, contentHeight);

    // === Keyboard ===
    useInput(
        (input, key) => {
            if (input === "q") {
                process.exitCode = hasFailures.current ? 1 : 0;
                exit();
                return;
            }

            // Tab switching only in review mode
            if (phase !== "done") return;

            if (key.tab) {
                const tabs: TabId[] = ["log", "summary", "results"];
                const idx = tabs.indexOf(activeTab);
                if (key.shift) {
                    setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]);
                } else {
                    setActiveTab(tabs[(idx + 1) % tabs.length]);
                }
                return;
            }

            if (input === "1") {
                setActiveTab("log");
                return;
            }
            if (input === "2") {
                setActiveTab("summary");
                return;
            }
            if (input === "3") {
                setActiveTab("results");
                return;
            }

            let scroll: typeof logScroll | null = null;
            if (activeTab === "log") scroll = logScroll;
            else if (activeTab === "results") scroll = resultsScroll;
            if (!scroll) return;

            if (input === "j" || key.downArrow) scroll.scrollDown();
            else if (input === "k" || key.upArrow) scroll.scrollUp();
            else if (key.pageDown) scroll.scrollPageDown();
            else if (key.pageUp) scroll.scrollPageUp();
            else if (input === "g") scroll.scrollToStart();
            else if (input === "G") scroll.scrollToEnd();
        },
        { isActive: IS_TTY },
    );

    // === Run tests ===
    useEffect(() => {
        async function run() {
            // Discovery phase
            setPhase("discovery");
            const discovery = discoverPlugins(opts);
            const discLines = buildDiscoveryStreamLines(discovery, streamIdRef);
            if (discLines.length > 0) {
                streamAccRef.current.push(...discLines);
                setStreamLines((prev) => prev.concat(discLines));
            }

            if (showStructural) {
                setPhase("structural");
                setStructRunning(true);

                const structAbort = opts.stopOnFail ? new AbortController() : null;

                await runStructural(
                    opts,
                    (r) => {
                        if (r.verdict === "fail") {
                            hasFailures.current = true;
                            if (structAbort) structAbort.abort();
                        }
                        pushStruct(r);
                    },
                    (section) => setStructSection(section),
                    structAbort?.signal,
                );
                stopStructBatch();
                setStructRunning(false);
            }

            if (showIntegration) {
                setPhase("integration");
                setIntRunning(true);

                // Periodic flush timer for integration results (every 200ms)
                const intFlushTimer = setInterval(() => {
                    setIntResults([...intResultsRef.current]);
                }, 200);

                await runIntegration(
                    opts,
                    (r) => {
                        if (r.verdict === "fail" || r.verdict === "error") {
                            hasFailures.current = true;
                        }
                        intResultsRef.current.push(r);
                    },
                    (testId, trigger) => {
                        setActiveTest(testId);
                        setActiveTrigger(trigger);
                    },
                    (total) => setIntTotal(total),
                );

                clearInterval(intFlushTimer);
                // Final flush
                setIntResults([...intResultsRef.current]);
                setActiveTest(null);
                setActiveTrigger(null);
                setIntRunning(false);
            }

            if (showResponseLog) {
                setPhase("response-log");
                setRlRunning(true);

                const rlFlushTimer = setInterval(() => {
                    setRlResults([...rlResultsRef.current]);
                }, 200);

                await runResponseLog(
                    opts,
                    (r) => {
                        if (r.verdict === "fail" || r.verdict === "error") {
                            hasFailures.current = true;
                        }
                        rlResultsRef.current.push(r);
                    },
                    (id, prompt) => {
                        setRlActiveId(id);
                        setRlActivePrompt(prompt);
                    },
                    (total) => setRlTotal(total),
                    (warning) => {
                        // Surface warnings as stream items
                        const warnItem: StreamItem = {
                            id: `rw-${streamIdRef.current++}`,
                            type: "detail",
                            text: `⚠ ${warning}`,
                            color: C.yellow,
                        };
                        streamAccRef.current.push(warnItem);
                        setStreamLines((prev) => [...prev, warnItem]);
                    },
                );

                clearInterval(rlFlushTimer);
                setRlResults([...rlResultsRef.current]);
                setRlActiveId(null);
                setRlActivePrompt(null);
                setRlRunning(false);
            }

            setPhase("done");

            // Free stream buffer — review mode uses structResults/intResults directly,
            // not the stream. The <Static> component has already rendered these items
            // to the terminal so they're no longer needed in memory.
            streamAccRef.current = [];

            // Generate report file if requested
            if (opts.report) {
                try {
                    const reportPath = writeReport(
                        opts,
                        getAllStruct(),
                        intResultsRef.current,
                        rlResultsRef.current,
                        Date.now() - startTimeRef.current,
                    );
                    setReportFile(reportPath);
                    if (opts.reportOpen && reportPath.endsWith(".html")) {
                        execFile("open", [reportPath], () => {});
                    }
                } catch (err) {
                    console.error("Failed to write report:", err);
                }
            }

            if (!IS_TTY || showResponseLog) {
                setTimeout(() => {
                    process.exitCode = hasFailures.current ? 1 : 0;
                    exit();
                }, 200);
            }
        }

        run().catch((err) => {
            console.error(err);
            exit();
            process.exitCode = 1;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const effectiveIntTotal = Math.max(intTotal, intResults.length);

    // =============================================
    // RENDER: Two modes
    // =============================================

    // --- Running mode: <Static> stream + small dynamic footer ---
    // Response-log mode stays in stream view (no review tabs) and auto-exits.
    if (phase !== "done" || showResponseLog) {
        const sc = countStructVerdicts(structResults);
        const ic = countIntVerdicts(intResults);
        // Count response-log verdicts inline (same verdict strings as integration)
        let rlPassed = 0,
            rlFailed = 0,
            rlWarned = 0;
        for (const r of rlResults) {
            if (r.verdict === "pass") rlPassed++;
            else if (r.verdict === "fail" || r.verdict === "error") rlFailed++;
            else if (r.verdict === "warn") rlWarned++;
        }
        const passed = sc.passed + ic.passed + rlPassed;
        const failed = sc.failed + ic.failed + rlFailed;
        const warns = sc.warned + ic.warned + rlWarned;
        const isDone = phase === "done";

        return (
            <>
                <Static items={streamLines}>
                    {(item) => <StreamLine key={item.id} item={item} />}
                </Static>

                <Box flexDirection="column">
                    {/* Spinner + active test */}
                    {!isDone && (
                        <Box paddingLeft={2} gap={1}>
                            <SlowSpinner />
                            {structRunning && (
                                <Text color={C.dimText}>
                                    Structural: {structSection} ({structResults.length} done)
                                </Text>
                            )}
                            {intRunning && (
                                <Text color={C.dimText}>
                                    {intTotal > 0
                                        ? `Integration [${intResults.length}/${intTotal}]`
                                        : "Integration loading…"}
                                    {activeTest ? `: ${activeTest}` : ""}
                                    {activeTrigger ? ` → "${activeTrigger}"` : ""}
                                </Text>
                            )}
                            {rlRunning &&
                                (() => {
                                    let truncPrompt = "";
                                    if (rlActivePrompt) {
                                        truncPrompt =
                                            rlActivePrompt.length > 50
                                                ? `${rlActivePrompt.slice(0, 47)}...`
                                                : rlActivePrompt;
                                    }
                                    return (
                                        <Text color={C.dimText}>
                                            Response Log
                                            {rlTotal > 0 ? ` [${rlResults.length}/${rlTotal}]` : ""}
                                            {rlActiveId ? `: ${rlActiveId}` : ""}
                                            {truncPrompt ? ` → "${truncPrompt}"` : ""}
                                        </Text>
                                    );
                                })()}
                            {!structRunning && !intRunning && !rlRunning && (
                                <Text color={C.dimText}>Starting…</Text>
                            )}
                        </Box>
                    )}

                    {/* Compact status */}
                    <Box paddingLeft={1} gap={2}>
                        {isDone ? (
                            <Text color={failed > 0 ? C.yellow : C.green} bold>
                                {failed > 0 ? "⚠ Done" : "✓ Done"}
                            </Text>
                        ) : null}
                        <Text color={C.green}>✔ {passed}</Text>
                        <Text color={failed > 0 ? C.red : C.dim}>✘ {failed}</Text>
                        <Text color={warns > 0 ? C.yellow : C.dim}>! {warns}</Text>
                        <Text color={C.dim}>│</Text>
                        <Text color={C.dimText}>{passed + failed + warns} tests</Text>
                        <Text color={C.dim}>│</Text>
                        <Text color={C.dimText}>{formatElapsed(elapsed)}</Text>
                        <Text color={C.dim}>│</Text>
                        <Text color={C.dimText}>{opts.mode}</Text>
                        {reportFile && (
                            <>
                                <Text color={C.dim}>│</Text>
                                <Text color={C.dimText}>report: {reportFile}</Text>
                            </>
                        )}
                    </Box>
                </Box>
            </>
        );
    }

    // --- Review mode: fullscreen tabbed UI (after tests complete) ---
    return (
        <Box flexDirection="column" height={rows - 1}>
            <Header opts={opts} />
            <TabBar active={activeTab} issueCount={issueCount} />

            <Box flexDirection="column" flexGrow={1}>
                {activeTab === "log" && (
                    <LogView
                        phase={phase}
                        structResults={structResults}
                        intResults={intResults}
                        intTotal={effectiveIntTotal}
                        structSection={structSection}
                        structRunning={false}
                        intRunning={false}
                        activeTest={null}
                        activeTrigger={null}
                        visibleHeight={contentHeight}
                        scrollOffset={logScroll.offset}
                    />
                )}

                {activeTab === "summary" && (
                    <SummaryView
                        phase={phase}
                        structural={structResults}
                        integration={intResults}
                        showStructural={showStructural}
                        showIntegration={showIntegration}
                        visibleHeight={contentHeight}
                    />
                )}

                {activeTab === "results" && (
                    <ResultsView
                        structural={structResults}
                        integration={intResults}
                        visibleHeight={contentHeight}
                        scrollOffset={resultsScroll.offset}
                    />
                )}
            </Box>

            <StatusBar
                phase={phase}
                activeTab={activeTab}
                structResults={structResults}
                intResults={intResults}
                intTotal={effectiveIntTotal}
                reportFile={reportFile}
                elapsed={elapsed}
                mode={opts.mode}
            />
        </Box>
    );
}
