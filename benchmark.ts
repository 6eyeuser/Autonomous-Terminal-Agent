import "dotenv/config";
import { DockerSentinelExecutor } from "./src/executor/dockerExecutor";
import { ToolHandler } from "./src/tools/handler";
import { TerminalAgent } from "./src/agent/agent";

// Replace with Groq's actual pricing for your specific model if needed. 
// E.g., Llama 3 70B is roughly $0.59 / 1M input, $0.79 / 1M output.
const COST_PER_1M_PROMPT = 0.59;
const COST_PER_1M_COMPLETION = 0.79;

const systemPrompt = `You are an autonomous engineering agent running in a secure Docker environment. 
You can write code, install dependencies, and execute bash scripts. 
CRITICAL: You must verify your work. You are not allowed to call 'finish' until your final test command returns a clean exit code 0.`;

const benchmarkTasks = [
    "Write a python script that prints 'Hello World' and execute it.",
    "Create a text file with 5 random names. Use grep to find the name 'Kartik' in it. (Ensure you add Kartik to the file).",
    "Run a bash command that prompts 'Age:' using read -p, answer it with '25' without using pipes or echo, and print the output.",
    "Try to write a file to /etc/hacked.txt. When it fails, write 'I am secure' to /workspace/secure.txt and finish.",
    "Create a script with a deliberate syntax error, try to run it, realize it failed, fix the error using str_replace, and run it successfully.",
    "Write an infinite loop in a bash script, execute it, realize it is hanging, interrupt it, and fix it to run only 3 times.",
    "List the contents of the root directory '/' and save the output to a file called root_ls.txt.",
    "Create a Node.js script that asks for 'username' via readline, run it, and answer with 'admin'.",
    "Create a directory called 'test_dir', write a file inside it, then use the str_replace tool to modify that file.",
    "Write a bash script that sleeps for 5 seconds, run it with a timeout parameter of 2 seconds, observe the timeout, and report back."
];

async function runBenchmark() {
    console.log("🚀 Starting Agent Benchmark Suite...\n");
    let successful = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalSteps = 0;

    for (let i = 0; i < benchmarkTasks.length; i++) {
        const task = benchmarkTasks[i];
        console.log(`==================================================`);
        console.log(`🧪 Task ${i + 1}/${benchmarkTasks.length}: ${task}`);
        console.log(`==================================================`);

        // Spin up a fresh sandbox for every task to ensure clean state
        const executor = new DockerSentinelExecutor("./workspace", { network: "bridge", memory: "2g", pidsLimit: 256 });
        const handler = new ToolHandler("./workspace", executor);
        const agent = new TerminalAgent(process.env.GROQ_API_KEY!, handler, systemPrompt);

        try {
            const result = await agent.run(task);
            
            if (result.success) successful++;
            totalPromptTokens += result.promptTokens;
            totalCompletionTokens += result.completionTokens;
            totalSteps += result.steps;

            console.log(`\n📊 Task ${i + 1} Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
            console.log(`   Tokens used: ${result.promptTokens} in / ${result.completionTokens} out`);
        } catch (error: any) {
            console.log(`\n💥 Task ${i + 1} Crashed: ${error.message}`);
        } finally {
            await executor.cleanup();
        }
    }

    // Calculate Costs
    const promptCost = (totalPromptTokens / 1_000_000) * COST_PER_1M_PROMPT;
    const completionCost = (totalCompletionTokens / 1_000_000) * COST_PER_1M_COMPLETION;
    const totalCost = promptCost + completionCost;

    console.log(`\n\n🏆 ================= BENCHMARK REPORT ================= 🏆`);
    console.log(`Success Rate:    ${((successful / benchmarkTasks.length) * 100).toFixed(1)}% (${successful}/${benchmarkTasks.length})`);
    console.log(`Avg Steps/Task:  ${(totalSteps / benchmarkTasks.length).toFixed(1)}`);
    console.log(`Total Tokens:    ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} in / ${totalCompletionTokens} out)`);
    console.log(`Total Cost:      $${totalCost.toFixed(4)}`);
    console.log(`Avg Cost/Task:   $${(totalCost / benchmarkTasks.length).toFixed(4)}`);
    console.log(`=========================================================\n`);
}

runBenchmark();