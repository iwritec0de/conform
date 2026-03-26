import React from "react";
import { Box, Text } from "ink";
import { SlowSpinner } from "./SlowSpinner.js";
import { C } from "../theme.js";
import { countStructVerdicts, countIntVerdicts } from "../verdicts.js";
import type { Phase, Mode, StructuralResult, IntegrationResult } from "../types.js";
import type { TabId } from "./TabBar.js";

interface StatusBarProps {
    phase: Phase;
    activeTab: TabId;
    structResults: StructuralResult[];
    intResults: IntegrationResult[];
    intTotal: number;
    reportFile?: string | null;
    elapsed: number;
    mode: Mode;
}

function formatElapsed(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function phaseLabel(phase: Phase, intCount: number, intTotal: number): string {
    if (phase === "structural") return "Structural";
    if (phase === "integration") {
        return intTotal > 0 ? `Integration [${intCount}/${intTotal}]` : "Integration";
    }
    return "Starting";
}

export const StatusBar = React.memo(function StatusBar({
    phase,
    activeTab: _activeTab,
    structResults,
    intResults,
    intTotal,
    reportFile,
    elapsed,
    mode,
}: StatusBarProps) {
    const sc = countStructVerdicts(structResults);
    const ic = countIntVerdicts(intResults);
    const passed = sc.passed + ic.passed;
    const failed = sc.failed + ic.failed;
    const warns = sc.warned + ic.warned;
    const total = passed + failed + warns;

    const isDone = phase === "done";

    return (
        <Box flexDirection="column">
            <Text color={C.dim}>{"─".repeat(60)}</Text>
            <Box paddingLeft={1} gap={2}>
                {/* Status */}
                {isDone ? (
                    <Text color={failed > 0 ? C.yellow : C.green} bold>
                        {failed > 0 ? "⚠ Done" : "✓ Done"}
                    </Text>
                ) : (
                    <Box gap={1}>
                        <SlowSpinner />
                        <Text color={C.white} bold>
                            {phaseLabel(phase, intResults.length, intTotal)}
                        </Text>
                    </Box>
                )}

                {/* Counts */}
                <Text color={C.green}>✔ {passed}</Text>
                <Text color={failed > 0 ? C.red : C.dim}>✘ {failed}</Text>
                <Text color={warns > 0 ? C.yellow : C.dim}>! {warns}</Text>

                {/* Total + time + mode */}
                <Text color={C.dim}>│</Text>
                <Text color={C.dimText}>{total} tests</Text>
                <Text color={C.dimText}>{formatElapsed(elapsed)}</Text>
                <Text color={C.dimText}>{mode}</Text>

                {/* Report indicator */}
                {reportFile && (
                    <>
                        <Text color={C.dim}>│</Text>
                        <Text color={C.dimText}>report: {reportFile}</Text>
                    </>
                )}

                {/* Key hints */}
                <Text color={C.dim}>│</Text>
                <Text color={C.dimText}>tab</Text>
                <Text color={C.dim}>switch</Text>
                <Text color={C.dimText}>↑↓</Text>
                <Text color={C.dim}>scroll</Text>
                <Text color={C.dimText}>q</Text>
                <Text color={C.dim}>quit</Text>
            </Box>
        </Box>
    );
});
