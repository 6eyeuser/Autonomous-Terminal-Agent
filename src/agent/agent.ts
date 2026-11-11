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
                description: "Execute a bash command in the sandboxed terminal. State (cwd, vars) persists across executions. If a command hangs or prompts, you will receive a waiting_for_input status.",
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
                description: "Send text to a command that is currently waiting for an interactive prompt (e.g., [y/n], passwords).",
                parameters: { 
                    type: "object", 
                    properties: { 
                        text: { type: "string", description: "The input string to send." },
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
                description: "Read a file. For large files, use start_line and end_line to paginate and avoid flooding context.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string" }, 
                        start_line: { type: "number", description: "1-indexed start line." }, 
                        end_line: { type: "number" } 
                    }, 
                    required: ["path"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "write_file",
                description: "Write a COMPLETELY NEW file. Do not use this to edit existing files.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string" }, 
                        content: { type: "string" } 
                    }, 
                    required: ["path", "content"] 
                }
            }
        },
        {
            type: "function",
            function: {
                name: "str_replace",
                description: "Replace an exact string in an existing file with new text. Safest way to edit.",
                parameters: { 
                    type: "object", 
                    properties: { 
                        path: { type: "string" }, 
                        old_str: { type: "string", description: "The exact literal string to be replaced. Must match perfectly." }, 
                        new_str: { type: "string" } 
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
                        summary: { type: "string" } 
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

        // TOKEN TRACKERS FOR BENCHMARKING
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;

        while (stepCount < MAX_STEPS) {
            stepCount++;
            console.log(`\n--- Step ${stepCount} ---`);

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

            // TRACK TOKENS
            if (response.usage) {
                totalPromptTokens += response.usage.prompt_tokens;
                totalCompletionTokens += response.usage.completion_tokens;
            }

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
                            
                            // RETURN BENCHMARK STATS ON SUCCESS
                            return {
                                success: true,
                                steps: stepCount,
                                promptTokens: totalPromptTokens,
                                completionTokens: totalCompletionTokens
                            }; 
                        default: 
                            toolResult = `Error: Unknown tool`;
                    }
                } catch (error: any) {
                    toolResult = `System Error: ${error.message}`;
                }

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
        
        // RETURN BENCHMARK STATS ON FAILURE
        return {
            success: false,
            steps: stepCount,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens
        };
    }
}