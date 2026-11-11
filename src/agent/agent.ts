import OpenAI from 'openai';
import { ToolHandler } from '../tools/handler';

export class TerminalAgent {
    private openai: OpenAI;
    private handler: ToolHandler;
    private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    private tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
            type: "function",
            function: {
                name: "execute_command",
                description: "Execute a bash command in the sandboxed terminal. State (like cwd and exported variables) persists across executions. If a command hangs or prompts for input, you will receive a waiting_for_input status.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        command: { type: "string", description: "The bash command to run." },
                        timeout_seconds: { type: "number", description: "Optional. Max execution time before interruption. Default is 30, max is 600." }
                    }, 
                    required: ["command"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "send_input",
                description: "Send text to a command that is currently waiting for an interactive prompt (e.g., [y/n] confirmations, password requests).",
                parameters: { 
                    type: "object", 
                    properties: { 
                        text: { type: "string", description: "The input string to send to the blocked process." },
                        timeout_seconds: { type: "number" }
                    }, 
                    required: ["text"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "interrupt",
                description: "Send Ctrl-C to abort a hanging command or escape a prompt you cannot answer. Resyncs the shell.",
                parameters: { type: "object", properties: {}, required: [] }
            }
        },
        {
            type: "function",
            function: {
                name: "read_file",
                description: "Read a file from the workspace. For large files, use start_line and end_line to paginate and avoid flooding your context window.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string", description: "Path to the file." }, 
                        start_line: { type: "number", description: "The line number to start reading from (1-indexed)." }, 
                        end_line: { type: "number", description: "The line number to stop reading at." } 
                    }, 
                    required: ["path"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "write_file",
                description: "Write a COMPLETELY NEW file. Do not use this to edit existing files as it will overwrite them entirely.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string", description: "Path where the file should be created." }, 
                        content: { type: "string", description: "The full content of the new file." } 
                    }, 
                    required: ["path", "content"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "str_replace",
                description: "Replace an exact string in an existing file with new text. This is the safest way to edit code.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string" }, 
                        old_str: { type: "string", description: "The exact literal string to be replaced. Must match spacing and newlines perfectly." }, 
                        new_str: { type: "string", description: "The new string to insert." } 
                    }, 
                    required: ["path", "old_str", "new_str"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "finish",
                description: "Call this tool ONLY when the task is completely verified and finished. You must run a test command that exits with code 0 before calling this.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        summary: { type: "string", description: "A detailed summary of the work completed." } 
                    }, 
                    required: ["summary"] 
                }
            }
        }
    ];

    constructor(apiKey: string, handler: ToolHandler, systemPrompt: string) {
        this.openai = new OpenAI({ apiKey: apiKey, baseURL: "https://api.groq.com/openai/v1" });
        this.handler = handler;
        this.messages = [{ role: "system", content: systemPrompt }];
    }

    public async run(task: string) {
        this.messages.push({ role: "user", content: task });
        console.log(`\n🎯 Objective: ${task}\n`);

        let stepCount = 0;
        const MAX_STEPS = 25; 

        while (stepCount < MAX_STEPS) {
            stepCount++;
            console.log(`\n--- Step ${stepCount} ---`);

            // AMNESIA FIX: Replace old heavy tool outputs with stubs to save tokens, 
            // but keep the assistant's actions so it remembers what it did.
            let activeMessages = [...this.messages];
            if (activeMessages.length > 12) {
                const preserveTailCount = 8; 
                for (let i = 2; i < activeMessages.length - preserveTailCount; i++) {
                    if (activeMessages[i].role === "tool") {
                        activeMessages[i] = { 
                            ...activeMessages[i], 
                            content: "[Tool output omitted to save context memory. Action was processed.]" 
                        };
                    }
                }
            }

            let response;
            let retries = 0;
            while (retries < 3) {
                try {
                    response = await this.openai.chat.completions.create({
                        model: "openai/gpt-oss-120b",
                        messages: activeMessages,
                        tools: this.tools,
                        tool_choice: "auto", 
                    });
                    break;
                } catch (apiError: any) {
                    if (apiError.status === 400 && apiError.error?.code === 'tool_use_failed') {
                        console.log(`⚠️ API rejected tool call. Nudging model to fix...`);
                        this.messages.push({ role: "user", content: `System Error: API rejected tool call. Ensure arguments are valid JSON.` });
                        break; 
                    } else if (apiError.status === 429 || apiError.status >= 500) {
                        retries++;
                        console.log(`⚠️ API error ${apiError.status}. Retrying in ${retries * 2}s...`);
                        await new Promise(r => setTimeout(r, retries * 2000));
                        if (retries === 3) throw apiError;
                    } else {
                        throw apiError;
                    }
                }
            }

            if (!response?.choices) continue;

            const msg = response.choices[0].message;
            this.messages.push(msg); 

            if (msg.content) console.log(`🤖 Thought: ${msg.content}`);

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                console.log("⚠️ Agent didn't use a tool. Nudging it...");
                this.messages.push({ role: "user", content: "You must use a tool to proceed, or call 'finish' if you are done." });
                continue;
            }

            for (const toolCall of msg.tool_calls) {
                if (toolCall.type !== "function") continue;

                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments);
                    console.log(`🛠️ Action: ${toolCall.function.name}`, args);
                } catch (e) {
                    this.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `System Error: Invalid JSON syntax.` } as any);
                    continue; 
                }

                let toolResult = "";
                try {
                    switch (toolCall.function.name) {
                        case "execute_command": 
                            toolResult = await this.handler.executeCommand(args); 
                            break;
                        case "send_input": 
                            toolResult = await this.handler.sendInput(args); 
                            break;
                        case "interrupt": 
                            toolResult = await this.handler.interrupt(); 
                            break;
                        case "read_file": 
                            toolResult = await this.handler.readFile(args); 
                            break;
                        case "write_file": 
                            toolResult = await this.handler.writeFile(args); 
                            break;
                        case "str_replace": 
                            toolResult = await this.handler.strReplace(args); 
                            break;
                        case "finish": 
                            if (this.handler.isDirty || this.handler.lastExitCode !== 0) {
                                toolResult = `System Error: Finish rejected. You must execute a command to test your recent changes, and it must exit with code 0 before you can finish.`;
                                console.log(`🔒 Finish Gate: Blocked unverified completion.`);
                                break;
                            }
                            console.log(`\n✅ Task Complete! Summary: ${args.summary}`); 
                            return; 
                        default: 
                            toolResult = `Error: Unknown tool`;
                    }
                } catch (error: any) {
                    toolResult = `System Error: ${error.message}`;
                }

                // LLM-Facing Truncation
                const MAX_LLM_CHARS = 8000;
                let safeToolResult = toolResult;
                if (toolResult.length > MAX_LLM_CHARS) {
                    const head = toolResult.slice(0, 4000);
                    const tail = toolResult.slice(-4000);
                    safeToolResult = `${head}\n\n...[${toolResult.length - MAX_LLM_CHARS} chars omitted to fit LLM window]...\n\n${tail}`;
                }

                this.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: safeToolResult } as any);
            }
        }
        console.log("\n❌ Agent hit max steps and was terminated.");
    }
}