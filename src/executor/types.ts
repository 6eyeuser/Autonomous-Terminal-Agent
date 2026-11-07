// src/executor/types.ts

export interface ExecutionResult {
    stdout: string;
    exitCode: number | null;
    durationMs: number;
    status: "completed" | "timeout" | "waiting_for_input" | "error";
}

export interface IExecutor {
    /**
     * Executes a command in the sandboxed environment.
     * @param command The bash command to run
     * @param timeoutMs Max execution time before aborting
     */
    execute(command: string, timeoutMs?: number): Promise<ExecutionResult>;
    
    /**
     * Cleans up the environment (e.g., kills the Docker container)
     */
    cleanup(): Promise<void>;
}
