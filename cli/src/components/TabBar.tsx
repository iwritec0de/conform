import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";

export type TabId = "log" | "summary" | "results";

interface TabBarProps {
    active: TabId;
    issueCount: number;
}

const TABS: { id: TabId; label: string }[] = [
    { id: "log", label: "Log" },
    { id: "summary", label: "Summary" },
    { id: "results", label: "Results" },
];

export const TabBar = React.memo(function TabBar({ active, issueCount }: TabBarProps) {
    return (
        <Box paddingLeft={1} gap={1}>
            {TABS.map((tab, i) => {
                const isActive = tab.id === active;
                let label = tab.label;
                if (tab.id === "results" && issueCount > 0) {
                    label = `${tab.label}(${issueCount})`;
                }

                return (
                    <React.Fragment key={tab.id}>
                        {isActive ? (
                            <Text color={C.cyan} bold>
                                ▸ {label}
                            </Text>
                        ) : (
                            <Text color={C.dimText}> {label}</Text>
                        )}
                        {i < TABS.length - 1 && <Text color={C.dim}>│</Text>}
                    </React.Fragment>
                );
            })}
        </Box>
    );
});
