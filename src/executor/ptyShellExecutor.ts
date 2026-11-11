import * as pty from "node-pty";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { IExecutor, ExecutionResult } from "./types";
import { cleanTerminalOutput, looksLikeInputPrompt } from "./outputCleaning";

export interface SpawnSpec {
    file: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

export interface PtyShellOptions {
    spawnSpec: () => SpawnSpec;
    scriptHostDir: string;
    scriptShellDir: string;
    onTeardown?: () => void;
    initTimeoutMs?: number; 
    idleInputMs?: number; 
    maxHeadChars?: number; 
    maxTailChars?: number; 
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newMarker = () => `__DONE_${randomUUID().replace(/-/g, "").slice(0, 12)}__`;

class OutputBuffer {
    private head = "";
    private tail = "";
    public dropped = 0;

    constructor(private maxHead: number, private maxTail: number) {}

    push(data: string): void {
        if (this.head.length < this.maxHead) {
            const room = this.maxHead - this.head.length;
            this.head += data.slice(0, room);
            data = data.slice(room);
        }
        if (data) {
            this.tail += data;
            if (this.tail.length > this.maxTail) {
                const over = this.tail.length - this.maxTail;
                this.tail = this.tail.slice(over);
                this.dropped += over;
            }
        }
    }

    clear(): void {
        this.head = "";
        this.tail = "";
        this.dropped = 0;
    }

    joined(): string {
        const gap = this.dropped > 0 ? `\n...[${this.dropped} characters omitted]...\n` : "";
        return this.head + gap + this.tail;
    }
}

type WaitMode = "command" | "probe";

export class PtyShellExecutor implements IExecutor {
    private proc!: pty.IPty;
    private buffer: OutputBuffer;
    private lastDataAt = Date.now();
    private dead = false;
    private shellExitCode: number | null = null;
    private pending: { marker: string; hostFile: string } | null = null;
    private ready: Promise<void>;
    private readonly o: Required<Omit<PtyShellOptions, "onTeardown">> & Pick<PtyShellOptions, "onTeardown">;

    constructor(options: PtyShellOptions) {
        this.o = {
            initTimeoutMs: 120_000,
            idleInputMs: 3_000,
            maxHeadChars: 20_000,
            maxTailChars: 200_000,
            ...options,
        };
        if (this.o.scriptShellDir.includes("'")) throw new Error("scriptShellDir must not contain a single quote");
        this.buffer = new OutputBuffer(this.o.maxHeadChars, this.o.maxTailChars);
        this.ready = this.start();
        this.ready.catch(() => {});
    }

    public async execute(command: string, timeoutMs: number = 30_000): Promise<ExecutionResult> {
        await this.ensureShell();
        if (this.pending) {
            return this.errorResult("A previous command is still waiting for input. Call sendInput() to answer it or interrupt() to abort it.");
        }

        const marker = newMarker();
        const scriptName = `cmd-${marker.slice(7, -2)}.sh`;
        const hostFile = path.join(this.o.scriptHostDir, scriptName);
        fs.mkdirSync(this.o.scriptHostDir, { recursive: true });
        try { fs.chmodSync(this.o.scriptHostDir, 0o777); } catch { }
        fs.writeFileSync(hostFile, command.replace(/\r\n/g, "\n") + "\n");

        this.pending = { marker, hostFile };
        this.buffer.clear();
        this.lastDataAt = Date.now();

        this.proc.write(
            `source '${this.o.scriptShellDir}/${scriptName}'; __ec=$?; set +eu; ` +
                `printf '\\n%s:%s\\n' '${marker}' "$__ec"\r`
        );
        return this.finish(await this.waitFor(marker, timeoutMs, true, "command"));
    }

    public async sendInput(text: string, timeoutMs: number = 30_000): Promise<ExecutionResult> {
        await this.ensureShell();
        if (!this.pending) return this.errorResult("No command is waiting for input.");
        this.buffer.clear();
        this.lastDataAt = Date.now();
        this.proc.write(text.replace(/\r?\n$/, "") + "\r");
        return this.finish(await this.waitFor(this.pending.marker, timeoutMs, true, "command"));
    }

    public async interrupt(): Promise<void> {
        await this.ensureShell();
        await this.resync();
        this.clearPending();
    }

    public async cleanup(): Promise<void> {
        try { this.proc?.kill(); } catch { }
        try { this.o.onTeardown?.(); } catch { }
        try { fs.rmSync(this.o.scriptHostDir, { recursive: true, force: true }); } catch { }
    }

    private async start(): Promise<void> {
        const spec = this.o.spawnSpec();
        this.dead = false;
        this.shellExitCode = null;
        this.pending = null;
        this.buffer.clear();

        const proc = pty.spawn(spec.file, spec.args, {
            name: "xterm",
            cols: 1000, 
            rows: 30,
            cwd: spec.cwd,
            env: spec.env as { [key: string]: string } | undefined,
        });
        this.proc = proc;
        proc.onData((d) => {
            if (this.proc !== proc) return; 
            this.buffer.push(d);
            this.lastDataAt = Date.now();
        });
        proc.onExit(({ exitCode }) => {
            if (this.proc !== proc) return;
            this.dead = true;
            this.shellExitCode = exitCode;
        });

        const marker = newMarker();
        proc.write(
            `stty -echo; set +H; PS1=''; PS2=''; PROMPT_COMMAND=''; ` +
                `printf '\\n%s:%s\\n' '${marker}' 0\r`
        );
        const r = await this.waitFor(marker, this.o.initTimeoutMs, false, "probe");
        if (r.status !== "completed") throw new Error(`Shell failed to start: ${r.stdout}`);
        this.buffer.clear();
    }

    private async ensureShell(): Promise<void> {
        try { await this.ready; } catch { await this.restart(); }
        if (this.dead) await this.restart();
    }

    private async restart(): Promise<void> {
        try { this.proc?.kill(); } catch { }
        try { this.o.onTeardown?.(); } catch { }
        this.ready = this.start();
        this.ready.catch(() => {});
        await this.ready;
    }

    private waitFor(marker: string, timeoutMs: number, detectInput: boolean, mode: WaitMode): Promise<ExecutionResult> {
        const startedAt = Date.now();
        const re = new RegExp(`${marker}:(\\d+)`);

        return new Promise((resolve) => {
            let busy = false;
            const timer = setInterval(async () => {
                if (busy) return;
                busy = true;
                try {
                    const durationMs = Date.now() - startedAt;
                    const raw = this.buffer.joined();

                    const m = re.exec(raw);
                    if (m) {
                        clearInterval(timer);
                        resolve(this.result(raw.slice(0, m.index), Number(m[1]), durationMs, "completed"));
                        return;
                    }
                    if (this.dead) {
                        clearInterval(timer);
                        resolve(this.result(raw + `\n[shell exited with code ${this.shellExitCode}. A fresh shell starts on the next command; cwd and env vars were reset.]`, this.shellExitCode, durationMs, "error"));
                        return;
                    }
                    if (durationMs > timeoutMs) {
                        clearInterval(timer);
                        if (mode === "probe") {
                            resolve(this.result(raw, null, durationMs, "timeout"));
                            return;
                        }
                        const recovered = await this.resync();
                        const note = recovered ? `\n[command interrupted after ${timeoutMs}ms]` : `\n[command did not respond to Ctrl-C; the shell was restarted and its state reset]`;
                        resolve(this.result(raw + note, null, durationMs, "timeout"));
                        return;
                    }
                    if (detectInput && Date.now() - this.lastDataAt > this.o.idleInputMs && looksLikeInputPrompt(raw)) {
                        clearInterval(timer);
                        resolve(this.result(raw, null, durationMs, "waiting_for_input"));
                    }
                } finally {
                    busy = false;
                }
            }, 50);
        });
    }

    private async resync(): Promise<boolean> {
        for (let attempt = 0; attempt < 2; attempt++) {
            this.proc.write("\x03");
            await sleep(300);
            const marker = newMarker();
            this.buffer.clear();
            this.proc.write(`stty -echo; printf '\\n%s:%s\\n' '${marker}' 0\r`);
            const r = await this.waitFor(marker, 3_000, false, "probe");
            if (r.status === "completed") {
                this.buffer.clear();
                return true;
            }
        }
        await this.restart();
        return false;
    }

    private finish(res: ExecutionResult): ExecutionResult {
        if (res.status !== "waiting_for_input") this.clearPending();
        return res;
    }

    private clearPending(): void {
        if (this.pending) {
            try { fs.rmSync(this.pending.hostFile, { force: true }); } catch { }
            this.pending = null;
        }
    }

    private result(raw: string, exitCode: number | null, durationMs: number, status: ExecutionResult["status"]): ExecutionResult {
        return {
            stdout: cleanTerminalOutput(raw),
            exitCode,
            durationMs,
            status,
            truncatedChars: this.buffer.dropped || undefined,
        };
    }

    private errorResult(message: string): ExecutionResult {
        return { stdout: message, exitCode: null, durationMs: 0, status: "error" };
    }
}