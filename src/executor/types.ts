export interface ExecutionResult {
    /** Cleaned output (ANSI codes stripped, carriage-return progress collapsed). */
    stdout: string;
    exitCode: number | null;
    durationMs: number;
    /**
     * completed         - the command finished; exitCode is valid
     * timeout           - the command was interrupted (Ctrl-C) after timeoutMs
     * waiting_for_input - the command is still running and looks like it is
     *                     blocked on a prompt. Call sendInput() or interrupt().
     * error             - the shell died or the executor itself failed
     */
    status: "completed" | "timeout" | "waiting_for_input" | "error";
    /** Characters dropped from the middle of very large output (head and tail are kept). */
    truncatedChars?: number;
}

export interface IExecutor {
    /**
     * Executes a command in the sandboxed environment.
     * @param command The bash command to run (may be multi-line)
     * @param timeoutMs Max execution time before the command is interrupted
     */
    execute(command: string, timeoutMs?: number): Promise<ExecutionResult>;

    /** Answers a prompt of a command that returned status "waiting_for_input". */
    sendInput?(text: string, timeoutMs?: number): Promise<ExecutionResult>;

    /** Aborts a command that is waiting for input and resyncs the shell. */
    interrupt?(): Promise<void>;

    /** Cleans up the environment (e.g., kills the Docker container). */
    cleanup(): Promise<void>;
}