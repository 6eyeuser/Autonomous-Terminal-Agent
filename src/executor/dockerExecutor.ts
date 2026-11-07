import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { IExecutor, ExecutionResult } from './types';
import * as path from 'path';

export class DockerSentinelExecutor implements IExecutor {
    private ptyProcess: pty.IPty;
    private outputBuffer: string = "";
    private containerName: string;

    constructor(workspacePath: string, image: string = "node:20-bookworm-slim") {
        this.containerName = `agent-sandbox-${randomUUID().slice(0, 8)}`;
        
        const absoluteWorkspace = path.resolve(workspacePath);

        const dockerRunCmd = [
            "run", "--rm", "-it",
            "--name", this.containerName,
            "-v", `${absoluteWorkspace}:/workspace`,
            "-w", "/workspace",
            "--memory=2g", "--cpus=2",
            "--security-opt", "no-new-privileges",
            image, "bash"
        ];

        this.ptyProcess = pty.spawn("docker", dockerRunCmd, {
            name: 'xterm-color',
            cols: 1000, 
            rows: 30,
        });

        this.ptyProcess.onData((data) => {
            this.outputBuffer += data;
        });
    }

    public async execute(command: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
        this.outputBuffer = ""; 
        const startTime = Date.now();
        
        const sentinelId = randomUUID().slice(0, 8);
        const sentinelMarker = `__DONE_${sentinelId}__`;

        // Mimic hitting the "Enter" key (\r) instead of using semicolons.
        // This safely handles multi-line commands, heredocs, and trailing comments.
        const wrappedCommand = [
            "stty -echo",
            command.replace(/\n/g, '\r'), // Convert any newlines in the AI's command to Enter strokes
            "EXIT_CODE=$?",
            "stty echo",
            "echo ''",
            `echo "${sentinelMarker}:$EXIT_CODE"`
        ].join('\r') + '\r';
        
        this.ptyProcess.write(wrappedCommand);

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const durationMs = Date.now() - startTime;

                if (durationMs > timeoutMs) {
                    clearInterval(checkInterval);
                    this.ptyProcess.write('\x03'); // Ctrl+C
                    resolve({
                        stdout: this.cleanOutput(this.outputBuffer),
                        exitCode: null,
                        durationMs,
                        status: "timeout"
                    });
                    return;
                }

                if (this.outputBuffer.includes(sentinelMarker)) {
                    clearInterval(checkInterval);
                    
                    const parts = this.outputBuffer.split(sentinelMarker);
                    let rawStdout = parts[0].trim();
                    
                    const exitCodeStr = parts[1].split('\n')[0].replace(':', '').trim();
                    const exitCode = parseInt(exitCodeStr, 10);

                    resolve({
                        stdout: this.cleanOutput(rawStdout),
                        exitCode: isNaN(exitCode) ? null : exitCode,
                        durationMs,
                        status: "completed"
                    });
                }
            }, 100); 
        });
    }

    private cleanOutput(output: string): string {
        // eslint-disable-next-line no-control-regex
        return output.replace(/\x1B\[\d+;?\d*[a-zA-Z]/g, '').trim();
    }

    public async cleanup(): Promise<void> {
        this.ptyProcess.kill();
        try {
            execSync(`docker rm -f ${this.containerName}`);
        } catch (e) {
            // Ignore if already gone
        }
    }
}