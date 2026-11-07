import * as fs from 'fs/promises';
import * as path from 'path';
import { IExecutor } from '../executor/types';
import { 
    ExecuteCommandSchema, 
    ReadFileSchema, 
    WriteFileSchema, 
    StrReplaceSchema 
} from './schemas';

export class ToolHandler {
    private workspaceRoot: string;
    private executor: IExecutor;

    constructor(workspaceRoot: string, executor: IExecutor) {
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.executor = executor;
    }

    /**
     * The Path Jail: Ensures the AI can never escape the workspace folder
     */
    private async resolveSafePath(targetPath: string): Promise<string> {
        const absolutePath = path.resolve(this.workspaceRoot, targetPath);
        if (!absolutePath.startsWith(this.workspaceRoot)) {
            throw new Error(`SECURITY VIOLATION: Path '${targetPath}' escapes the workspace.`);
        }
        return absolutePath;
    }

    public async executeCommand(args: unknown): Promise<string> {
        const parsed = ExecuteCommandSchema.parse(args);
        const result = await this.executor.execute(parsed.command);
        return `Exit Code: ${result.exitCode}\nOutput:\n${result.stdout || "<no output>"}`;
    }

    public async readFile(args: unknown): Promise<string> {
        const parsed = ReadFileSchema.parse(args);
        const safePath = await this.resolveSafePath(parsed.path);
        
        try {
            const content = await fs.readFile(safePath, 'utf-8');
            const lines = content.split('\n');
            
            const start = parsed.start_line ? Math.max(1, parsed.start_line) - 1 : 0;
            const end = parsed.end_line ? Math.min(lines.length, parsed.end_line) : lines.length;
            
            return lines.slice(start, end).join('\n');
        } catch (e: any) {
            return `Error reading file: ${e.message}`;
        }
    }

    public async writeFile(args: unknown): Promise<string> {
        const parsed = WriteFileSchema.parse(args);
        const safePath = await this.resolveSafePath(parsed.path);
        
        try {
            // Create subdirectories if they don't exist
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            await fs.writeFile(safePath, parsed.content, 'utf-8');
            return `Successfully wrote to ${parsed.path}`;
        } catch (e: any) {
            return `Error writing file: ${e.message}`;
        }
    }

    public async strReplace(args: unknown): Promise<string> {
        const parsed = StrReplaceSchema.parse(args);
        const safePath = await this.resolveSafePath(parsed.path);
        
        try {
            const content = await fs.readFile(safePath, 'utf-8');
            
            // Count occurrences
            const occurrences = content.split(parsed.old_str).length - 1;
            
            if (occurrences === 0) {
                return `Error: old_str not found in file.`;
            } else if (occurrences > 1) {
                return `Error: old_str found ${occurrences} times. It must be completely unique to prevent accidental overwrites. Provide more context in old_str.`;
            }

            const newContent = content.replace(parsed.old_str, parsed.new_str);
            await fs.writeFile(safePath, newContent, 'utf-8');
            return `Successfully replaced text in ${parsed.path}`;
        } catch (e: any) {
            return `Error replacing text: ${e.message}`;
        }
    }
}