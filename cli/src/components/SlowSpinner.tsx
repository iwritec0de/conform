import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { C } from "../theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 300; // ms — much slower than ink-spinner's ~80ms

export const SlowSpinner = React.memo(function SlowSpinner() {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((prev) => (prev + 1) % FRAMES.length);
        }, INTERVAL);
        return () => clearInterval(timer);
    }, []);

    return <Text color={C.cyan}>{FRAMES[frame]}</Text>;
});
