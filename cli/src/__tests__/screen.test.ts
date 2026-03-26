import { jest, describe, it, expect, beforeEach } from "@jest/globals";

describe("screen utilities", () => {
    let writeSpy: jest.SpiedFunction<typeof process.stdout.write>;

    beforeEach(() => {
        writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
    });

    // isTTY is evaluated at import time, so we test both branches
    // by dynamically importing with different isTTY values

    describe("when stdout is a TTY", () => {
        let screen: typeof import("../screen.js");

        beforeAll(async () => {
            const original = process.stdout.isTTY;
            Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
            // Force re-import to re-evaluate isTTY
            screen = await import("../screen.js?" + Date.now());
            Object.defineProperty(process.stdout, "isTTY", { value: original, writable: true });
        });

        it("hideCursor writes escape sequence", () => {
            screen.hideCursor();
            expect(writeSpy).toHaveBeenCalledWith("\x1b[?25l");
        });

        it("showCursor writes escape sequence", () => {
            screen.showCursor();
            expect(writeSpy).toHaveBeenCalledWith("\x1b[?25h");
        });

        it("cleanup calls showCursor", () => {
            screen.cleanup();
            expect(writeSpy).toHaveBeenCalledWith("\x1b[?25h");
        });
    });

    describe("when stdout is not a TTY", () => {
        let screen: typeof import("../screen.js");

        beforeAll(async () => {
            const original = process.stdout.isTTY;
            Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
            screen = await import("../screen.js?notty" + Date.now());
            Object.defineProperty(process.stdout, "isTTY", { value: original, writable: true });
        });

        it("hideCursor does not write", () => {
            screen.hideCursor();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it("showCursor does not write", () => {
            screen.showCursor();
            expect(writeSpy).not.toHaveBeenCalled();
        });
    });
});

// Need to import these for beforeAll/afterEach at top scope
import { afterEach, beforeAll } from "@jest/globals";
