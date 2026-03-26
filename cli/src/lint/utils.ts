import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function isKebabCase(s: string): boolean {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

export function fileExists(path: string): boolean {
    return existsSync(path);
}

export function readFile(path: string): string {
    return readFileSync(path, "utf-8");
}

export function isDir(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
}

export function listDir(path: string): string[] {
    if (!isDir(path)) return [];
    return readdirSync(path);
}

export function listFiles(dir: string, ext?: string): string[] {
    return listDir(dir).filter((f) => {
        const full = join(dir, f);
        if (!statSync(full).isFile()) return false;
        return ext ? f.endsWith(ext) : true;
    });
}

export function parseJson(
    content: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
    try {
        return { ok: true, data: JSON.parse(content) };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

export interface Frontmatter {
    raw: string;
    fields: Record<string, string>;
    body: string;
    bodyWordCount: number;
}

const MULTILINE_MARKERS = new Set([">-", ">", "|", "|-"]);

function flushPending(
    fields: Record<string, string>,
    key: string,
    mode: "multiline" | "list" | null,
    value: string,
    listItems: string[],
): void {
    if (mode === "multiline") fields[key] = value;
    else if (mode === "list" && listItems.length > 0) fields[key] = listItems.join(", ");
}

function parseYamlFields(yamlLines: string[]): Record<string, string> {
    const fields: Record<string, string> = {};

    let currentKey = "";
    let currentValue = "";
    let mode: "multiline" | "list" | null = null;
    const listItems: string[] = [];

    for (const line of yamlLines) {
        if (mode === "list") {
            const listMatch = /^\s+-\s+(.*)/.exec(line);
            if (listMatch) {
                listItems.push(listMatch[1].trim());
                continue;
            }
            flushPending(fields, currentKey, mode, currentValue, listItems);
            mode = null;
            listItems.length = 0;
        }

        if (mode === "multiline") {
            if (/^\s{2,}/.test(line)) {
                const trimmed = line.trim();
                currentValue = currentValue ? `${currentValue} ${trimmed}` : trimmed;
                continue;
            }
            flushPending(fields, currentKey, mode, currentValue, listItems);
            mode = null;
        }

        const match = /^(\S+):\s*(.*)/.exec(line);
        if (!match) continue;

        currentKey = match[1];
        const val = match[2].trim().replace(/^["']|["']$/g, "");

        if (MULTILINE_MARKERS.has(val)) {
            currentValue = "";
            mode = "multiline";
        } else if (val === "") {
            mode = "list";
        } else {
            fields[currentKey] = val;
        }
    }

    flushPending(fields, currentKey, mode, currentValue, listItems);
    return fields;
}

export function parseFrontmatter(content: string): Frontmatter | null {
    const lines = content.split("\n");
    if (lines[0]?.trim() !== "---") return null;

    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === "---") {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) return null;

    const raw = lines.slice(1, endIdx).join("\n");
    const fields = parseYamlFields(lines.slice(1, endIdx));

    const body = lines.slice(endIdx + 1).join("\n");
    const bodyWordCount = body.split(/\s+/).filter(Boolean).length;

    return { raw, fields, body, bodyWordCount };
}
