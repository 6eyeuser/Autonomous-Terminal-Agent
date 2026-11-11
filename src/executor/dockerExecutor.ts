import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import * as path from "path";
import { PtyShellExecutor } from "./ptyShellExecutor";

export interface DockerExecutorOptions {
    image?: string;
    network?: "none" | "bridge";
    user?: string;
    memory?: string;
    cpus?: string;
    pidsLimit?: number;
    extraEnv?: Record<string, string>;
}

export class DockerSentinelExecutor extends PtyShellExecutor {
    constructor(workspacePath: string, options: DockerExecutorOptions = {}) {
        const workspace = path.resolve(workspacePath);
        const {
            image = "node:20-bookworm-slim",
            network = "none",
            user,
            memory = "2g",
            cpus = "2",
            pidsLimit = 256,
            extraEnv = {},
        } = options;

        let containerName = "";

        super({
            scriptHostDir: path.join(workspace, ".agent"),
            scriptShellDir: "/workspace/.agent",
            spawnSpec: () => {
                containerName = `agent-sandbox-${randomUUID().slice(0, 8)}`;
                const env = {
                    TERM: "dumb",
                    HOME: "/tmp",
                    npm_config_cache: "/tmp/.npm",
                    DEBIAN_FRONTEND: "noninteractive",
                    ...extraEnv,
                };
                const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
                
                const dockerArgs = [
                    "run", "--rm", "-it",
                    "--name", containerName,
                    "-v", `${workspace}:/workspace`,
                    "-w", "/workspace",
                    "--memory", memory,
                    "--cpus", cpus,
                    "--pids-limit", String(pidsLimit),
                    "--network", network,
                    "--cap-drop=ALL",
                    "--security-opt", "no-new-privileges"
                ];

                if (user) {
                    dockerArgs.push("--user", user);
                }

                dockerArgs.push(...envArgs, image, "bash", "--noediting", "--norc", "--noprofile");

                return {
                    file: "docker",
                    args: dockerArgs,
                };
            },
            onTeardown: () => {
                if (!containerName) return;
                try {
                    execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
                } catch { }
            },
        });
    }
}