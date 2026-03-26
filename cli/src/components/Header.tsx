import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import type { CliOptions } from "../types.js";

interface HeaderProps {
    opts: CliOptions;
}

export const Header = React.memo(function Header({ opts }: HeaderProps) {
    const modeLabel = opts.mode;

    const target = opts.target.split("/").slice(-2).join("/");

    return (
        <Box
            borderStyle="round"
            borderColor={C.dim}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
        >
            <Text color={C.cyan} bold>
                ◆ conform
            </Text>
            <Box gap={2}>
                <Text>
                    <Text color={C.dimText}>mode:</Text>
                    <Text color={C.white}> {modeLabel}</Text>
                </Text>
                <Text>
                    <Text color={C.dimText}>model:</Text>
                    <Text color={C.white}> {opts.model}</Text>
                </Text>
                <Text>
                    <Text color={C.dimText}>target:</Text>
                    <Text color={C.white}> {target}</Text>
                </Text>
                {opts.dryRun && (
                    <Text color={C.yellow} bold>
                        [DRY RUN]
                    </Text>
                )}
            </Box>
        </Box>
    );
});
