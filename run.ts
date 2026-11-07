import 'dotenv/config';
import { DockerSentinelExecutor } from './src/executor/dockerExecutor';
import { ToolHandler } from './src/tools/handler';
import { TerminalAgent } from './src/agent/agent';
import * as readline from 'readline/promises';

async function main() {
    if (!process.env.GROQ_API_KEY) {
        console.error("Missing GROQ_API_KEY in .env file");
        process.exit(1);
    }

    const workspacePath = './workspace';
    console.log("🚀 Spinning up Docker Sandbox...");
    
    // The executor and handler are initialized OUTSIDE the loop so the container persists
    const executor = new DockerSentinelExecutor(workspacePath);
    const toolHandler = new ToolHandler(workspacePath, executor);

    console.log("⏳ Waiting for container to initialize...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    const systemPrompt = `You are an elite, autonomous backend software engineer.
You are running in a secure Ubuntu Docker container. Your workspace is mounted at /workspace.
Follow these rules strictly:
1. Reason step-by-step before acting.
2. ALWAYS verify your work. If you write a script, run it to ensure it works. 
3. If a command fails or a script throws an error, read the error output, fix the file, and try again.
4. When you are 100% confident the objective is achieved and verified, call the 'finish' tool.`;

    // Create an interactive CLI loop
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log("\n🤖 Agent is ready! What would you like me to build?");
    console.log("(Type 'exit' to tear down the sandbox and quit)\n");

    try {
        while (true) {
            const task = await rl.question('Prompt > ');
            
            if (task.trim().toLowerCase() === 'exit') {
                break; // Break the loop and trigger cleanup
            }

            if (!task.trim()) continue; // Skip empty prompts

            // Create a FRESH agent for every new prompt so memory doesn't bleed over
            const agent = new TerminalAgent(process.env.GROQ_API_KEY, toolHandler, systemPrompt);

            // Run the agent on the user's input
            await agent.run(task);
            
            console.log("\nReady for the next task! (The sandbox is still active)");
        }
    } catch (e) {
        console.error("Fatal Error during agent execution:", e);
    } finally {
        console.log("\n🧹 Tearing down Docker Sandbox...");
        rl.close();
        await executor.cleanup();
        process.exit(0);
    }
}

main();