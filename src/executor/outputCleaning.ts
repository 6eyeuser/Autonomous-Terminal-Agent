// Pattern adapted from the `ansi-regex` package (MIT). Covers CSI sequences
// (colors, cursor movement, erase), OSC sequences, and private modes such as
// bracketed paste (ESC[?2004h) that a naive /\x1B\[\d+m/ misses.
const ANSI_PATTERN = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
].join("|");
const ANSI_RE = new RegExp(ANSI_PATTERN, "g");

// Remaining control characters, keeping \t \n \r.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, "");
}

/**
 * Progress bars redraw a line with "\r". Keep only what the user would see at
 * the end of each line, and normalise "\r\n" to "\n".
 */
export function collapseCarriageReturns(s: string): string {
    return s
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => {
            if (!line.includes("\r")) return line;
            const segments = line.split("\r").filter((seg) => seg.length > 0);
            return segments.length ? segments[segments.length - 1] : "";
        })
        .join("\n");
}

export function cleanTerminalOutput(raw: string, trim: boolean = true): string {
    const cleaned = collapseCarriageReturns(stripAnsi(raw)).replace(CONTROL_RE, "");
    return trim ? cleaned.replace(/^\n+/, "").trimEnd() : cleaned;
}

const PROMPT_RE =
    /(\[y\/n\]|\(y\/n\)|\[yes\/no\]|\(yes\/no\)|password.*:|passphrase.*:|\?\s*$|:\s$)/i;

/** True if the last (unfinished) line of the output looks like an input prompt. */
export function looksLikeInputPrompt(raw: string): boolean {
    const lastLine = cleanTerminalOutput(raw, false).split("\n").pop() ?? "";
    return PROMPT_RE.test(lastLine);
}