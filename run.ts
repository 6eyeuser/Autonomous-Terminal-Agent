import "dotenv/config";
import * as readline from "readline";
import { DockerSentinelExecutor } from "./src/executor/dockerExecutor";
import { ToolHandler } from "./src/tools/handler";
import { TerminalAgent } from "./src/agent/agent";


const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(res => rl.question(q, res));

async function main() {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing in .env");
    
    console.log("🚀 Spinning up Docker Sandbox...");
    
    // Note: To install apt/npm packages securely, this runs as the default root user 
    // to pass apt permissions, but explicitly drops all kernel capabilities.
    const executor = new DockerSentinelExecutor("./workspace", {
        network: "bridge",
        memory: "2g",
        pidsLimit: 256
    });
    
    // Graceful teardown on Ctrl+C
    process.on('SIGINT', async () => {
        console.log("\n🛑 Caught interrupt signal. Tearing down sandbox...");
        await executor.cleanup();
        process.exit(0);
    });

    const handler = new ToolHandler("./workspace", executor);
    
    const systemPrompt = `You are an autonomous engineering agent running in a secure Docker environment. 
You can write code, install dependencies, and execute bash scripts. 
CRITICAL: You must verify your work. You are not allowed to call 'finish' until your final test command returns a clean exit code 0.`;

    console.log("🤖 Agent is ready! What would you like me to build?");
    
    try {
        while (true) {
            const task = await ask("\nPrompt > ");
            if (task.trim().toLowerCase() === "exit") break;
            
            const agent = new TerminalAgent(process.env.GROQ_API_KEY, handler, systemPrompt);
            try {
                await agent.run(task);
            } catch (err: any) {
                console.log(`\n❌ Agent encountered a fatal error during this task: ${err.message}`);
                console.log("The sandbox is still active. You can try a new prompt.");
            }
        }
    } finally {
        console.log("🧹 Tearing down Docker Sandbox...");
        await executor.cleanup();
        rl.close();
    }
}
main();