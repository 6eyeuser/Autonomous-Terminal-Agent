import * as fs from 'fs';
import * as path from 'path';
import { IExecutor, ExecutionResult } from '../executor/types';
import { resolveInsideWorkspace } from './safePath';

export class ToolHandler {
    private workspacePath: string;
    private executor: IExecutor;
    
    // Tracks state to ensure the AI tests its code before finishing
    public isDirty: boolean = false;
    public lastExitCode: number | null = null;

    constructor(workspacePath: string, executor: IExecutor) {
        this.workspacePath = path.resolve(workspacePath);
        this.executor = executor;
        
        if (!fs.existsSync(this.workspacePath)) {
            fs.mkdirSync(this.workspacePath, { recursive: true });
        }
    }

    private getSafeHostPath(requestedPath: string): string {
        return resolveInsideWorkspace(this.workspacePath, requestedPath);
    }

    public async executeCommand(args: { command: string; timeout_seconds?: number }): Promise<string> {
        const timeoutMs = args.timeout_seconds ? Math.min(args.timeout_seconds * 1000, 600000) : 30000;
        const res = await this.executor.execute(args.command, timeoutMs);
        
        this.lastExitCode = res.exitCode;
        if (res.exitCode === 0) {
            this.isDirty = false; // A clean execution verifies the workspace
        }
        
        return this.formatResult(res);
    }

    public async sendInput(args: { text: string; timeout_seconds?: number }): Promise<string> {
        if (!(this.executor as any).sendInput) return "System Error: Executor does not support sendInput.";
        const timeoutMs = args.timeout_seconds ? Math.min(args.timeout_seconds * 1000, 600000) : 30000;
        const res = await (this.executor as any).sendInput(args.text, timeoutMs);
        
        this.lastExitCode = res.exitCode;
        if (res.exitCode === 0) this.isDirty = false;
        
        return this.formatResult(res);
    }

    public async interrupt(): Promise<string> {
        if (!(this.executor as any).interrupt) return "System Error: Executor does not support interrupt.";
        await (this.executor as any).interrupt();
        return "✅ Command interrupted successfully. Shell is ready for the next command.";
    }

    private formatResult(res: ExecutionResult): string {
        let out = res.stdout || "[No output]";
        if (res.truncatedChars) out += `\n...[${res.truncatedChars} characters omitted from middle by PTY buffer]...`;
        if (res.status === "waiting_for_input") out += `\n\n[⚠️ Command is blocked waiting for input. Call send_input to answer it, or interrupt to abort.]`;
        else if (res.status === "timeout") out += `\n\n[⚠️ Command timed out]`;
        else if (res.status === "error" && res.exitCode !== null) out += `\n\n[⚠️ Shell crashed with exit code ${res.exitCode}. A fresh shell was started.]`;
        return out;
    }

    public async readFile(args: { path: string; start_line?: number; end_line?: number }): Promise<string> {
        try {
            const safePath = this.getSafeHostPath(args.path);
            if (!fs.existsSync(safePath)) return `Error: File not found at ${args.path}`;

            const content = fs.readFileSync(safePath, 'utf8');
            const lines = content.split('\n');

            const start = args.start_line ? Math.max(0, args.start_line - 1) : 0;
            const end = args.end_line ? Math.min(lines.length, args.end_line) : lines.length;
            
            // Add line numbers so the AI knows exactly what to edit
            let output = lines.slice(start, end).map((line, i) => `${start + i + 1} | ${line}`).join('\n');
            
            if (end < lines.length) {
                output += `\n...[File continues to line ${lines.length}. Use start_line and end_line to read more.]`;
            }

            return output;
        } catch (error: any) {
            return `System Error: ${error.message}`;
        }
    }

    public async writeFile(args: { path: string; content: string }): Promise<string> {
        try {
            const safePath = this.getSafeHostPath(args.path);
            fs.mkdirSync(path.dirname(safePath), { recursive: true });
            fs.writeFileSync(safePath, args.content);
            this.isDirty = true; // Workspace changed, needs verification
            return `Successfully wrote to ${args.path}. (Note: You must execute a command to verify this change before finishing).`;
        } catch (error: any) {
            return `System Error: ${error.message}`;
        }
    }

    public async strReplace(args: { path: string; old_str: string; new_str: string }): Promise<string> {
        try {
            if (!args.old_str) return `Error: old_str cannot be empty.`;
            const safePath = this.getSafeHostPath(args.path);
            if (!fs.existsSync(safePath)) return `Error: File not found at ${args.path}`;

            const content = fs.readFileSync(safePath, 'utf8');
            if (!content.includes(args.old_str)) return `Error: Exact old_str not found in file. Check spacing/newlines.`;

            const newContent = content.replace(args.old_str, () => args.new_str);
            fs.writeFileSync(safePath, newContent);
            this.isDirty = true; // Workspace changed, needs verification
            return `Successfully replaced text in ${args.path}. (Note: You must execute a command to verify this change before finishing).`;
        } catch (error: any) {
            return `System Error: ${error.message}`;
        }
    }
}