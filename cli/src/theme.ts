// Dracula palette — matches the web mockup exactly
export const C = {
    green: "#50fa7b",
    red: "#ff5555",
    yellow: "#f1fa8c",
    cyan: "#8be9fd",
    magenta: "#ff79c6",
    purple: "#bd93f9",
    orange: "#ffb86c",
    white: "#f8f8f2",
    dim: "#44475a",
    dimText: "#6272a4",
} as const;

// Raw ANSI escape codes for non-Ink output (CI mode, stderr)
// Respects NO_COLOR (https://no-color.org/) and FORCE_COLOR=0
const useColor = !("NO_COLOR" in process.env) && process.env.FORCE_COLOR !== "0";

export const A = useColor
    ? ({
          red: "\x1b[31m",
          green: "\x1b[32m",
          yellow: "\x1b[33m",
          blue: "\x1b[34m",
          magenta: "\x1b[35m",
          cyan: "\x1b[36m",
          bold: "\x1b[1m",
          dim: "\x1b[90m",
          reset: "\x1b[0m",
      } as const)
    : ({
          red: "",
          green: "",
          yellow: "",
          blue: "",
          magenta: "",
          cyan: "",
          bold: "",
          dim: "",
          reset: "",
      } as const);
