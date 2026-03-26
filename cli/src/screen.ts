const isTTY = !!process.stdout.isTTY;

export function hideCursor() {
    if (isTTY) process.stdout.write("\x1b[?25l");
}

export function showCursor() {
    if (isTTY) process.stdout.write("\x1b[?25h");
}

export function cleanup() {
    showCursor();
}
