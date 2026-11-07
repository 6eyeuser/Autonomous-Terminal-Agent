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
                description: "Execute a bash command in the sandboxed terminal.",
                parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
            }
        },
        {
            type: "function",
            function: {
                name: "read_file",
                description: "Read a file. Provide start_line and end_line for large files to save context.",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } },
                    required: ["path"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "write_file",
                description: "Write a COMPLETELY NEW file. Do not use this to edit existing files.",
                parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
            }
        },
        {
            type: "function",
            function: {
                name: "str_replace",
                description: "Replace an exact string in an existing file with new text. Much safer than write_file for edits.",
                parameters: { type: "object", properties: { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } }, required: ["path", "old_str", "new_str"] }
            }
        },
        {
            type: "function",
            function: {
                name: "finish",
                description: "Call this tool ONLY when the task is completely verified and finished.",
                parameters: { type: "object", properties: { summary: { type: "string", description: "Summary of what you did" } }, required: ["summary"] }
            }
        }
    ];

    constructor(apiKey: string, handler: ToolHandler, systemPrompt: string) {
        this.openai = new OpenAI({ 
            apiKey: apiKey,
            baseURL: "https://api.groq.com/openai/v1"
        });
        
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

            let activeMessages = this.messages;
            if (this.messages.length > 9) {
                activeMessages = [
                    this.messages[0], 
                    this.messages[1], 
                    ...this.messages.slice(-6)
                ];
            }

            let response;
            try {
                response = await this.openai.chat.completions.create({
                    model: "openai/gpt-oss-120b",
                    messages: activeMessages,
                    tools: this.tools,
                    tool_choice: "auto", 
                });
            } catch (apiError: any) {
                if (apiError.status === 400 && apiError.error?.code === 'tool_use_failed') {
                    console.log(`⚠️ API rejected tool call (${apiError.error.message}). Nudging model to fix...`);
                    this.messages.push({
                        role: "user",
                        content: `System Error: The API rejected your tool call. ${apiError.error.message}. You must only use the tools explicitly provided: [${this.tools.map(t => (t as any).function.name).join(', ')}]. Ensure arguments are valid JSON.`
                    });
                    continue; 
                }
                throw apiError;
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
                    console.log(`⚠️ Model generated invalid JSON for ${toolCall.function.name}. Requesting fix...`);
                    // Bypass TS strict checking with `as any` to satisfy Groq's backend requirement
                    this.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name, 
                        content: `System Error: The JSON arguments you provided were invalid. Please check your quoting, escape characters (like \\n), and ensure valid JSON syntax. Try the action again.`
                    } as any);
                    continue; 
                }

                let toolResult = "";
                try {
                    switch (toolCall.function.name) {
                        case "execute_command":
                            toolResult = await this.handler.executeCommand(args);
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
                            console.log(`\n✅ Task Complete! Summary: ${args.summary}`);
                            return; 
                        default:
                            toolResult = `Error: Unknown tool ${toolCall.function.name}`;
                    }
                } catch (error: any) {
                    toolResult = `System Error: ${error.message}`;
                }

                // Widen the view so the AI can read whole scripts without looping
                const MAX_LLM_OUTPUT = 2000; 
                let safeToolResult = toolResult;
                if (toolResult.length > MAX_LLM_OUTPUT) {
                    safeToolResult = toolResult.substring(0, MAX_LLM_OUTPUT) + `\n...[Output truncated to prevent token overflow]`;
                }

                const consoleOutput = safeToolResult.length > 300 ? safeToolResult.substring(0, 300) + '... (console truncated)' : safeToolResult;
                console.log(`📋 Result: \n${consoleOutput}`);

                // Bypass TS strict checking with `as any` to satisfy Groq's backend requirement
                this.messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: safeToolResult
                } as any);
            }
        }

        console.log("\n❌ Agent hit max steps and was terminated.");
    }
}