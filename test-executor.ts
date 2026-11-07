import { DockerSentinelExecutor } from './src/executor/dockerExecutor';

async function runTest() {
    console.log("🚀 Starting Docker Sandbox...");
    const executor = new DockerSentinelExecutor('./workspace');

    await new Promise(res => setTimeout(res, 2000));

    console.log("\n1️⃣ Running basic command (ls -la)...");
    let result = await executor.execute("ls -la");
    console.log(`Status: ${result.status}, Exit Code: ${result.exitCode}`);
    console.log(`Output:\n${result.stdout}`);

    console.log("\n2️⃣ Running command that fails...");
    result = await executor.execute("cat non_existent_file.txt");
    console.log(`Status: ${result.status}, Exit Code: ${result.exitCode}`);
    console.log(`Output:\n${result.stdout}`);

    console.log("\n3️⃣ Writing a file to the workspace...");
    result = await executor.execute("echo 'Hello from Docker!' > test.txt && cat test.txt");
    console.log(`Status: ${result.status}, Exit Code: ${result.exitCode}`);
    console.log(`Output:\n${result.stdout}`);

    console.log("\n🧹 Cleaning up container...");
    await executor.cleanup();
    console.log("✅ Done!");
}

runTest();