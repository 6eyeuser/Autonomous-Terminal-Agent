import { z } from 'zod';

// 1. Execute a command in the terminal
export const ExecuteCommandSchema = z.object({
    command: z.string().describe("The bash command to execute in the terminal."),
});

// 2. Read a file with line limits (prevents blowing up the context window)
export const ReadFileSchema = z.object({
    path: z.string().describe("The path to the file to read, relative to the workspace root."),
    start_line: z.number().optional().describe("Line number to start reading from (1-indexed)."),
    end_line: z.number().optional().describe("Line number to end reading at (1-indexed).")
});

// 3. Write a completely new file
export const WriteFileSchema = z.object({
    path: z.string().describe("The path where the file should be created."),
    content: z.string().describe("The complete content of the file.")
});

// 4. Safe String Replace (much safer than the AI trying to use 'sed' via the terminal)
export const StrReplaceSchema = z.object({
    path: z.string().describe("The path to the file to modify."),
    old_str: z.string().describe("The exact string to be replaced. Must match exactly once in the file."),
    new_str: z.string().describe("The new string to insert in place of old_str.")
});