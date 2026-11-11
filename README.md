🤖 Autonomous Docker Terminal Agent

Welcome to the Autonomous Docker Terminal Agent.

If you've ever played with open-source AI coding assistants, you know their dirty little secret: the moment a bash script asks Do you want to continue? [y/N] or prompts for a password, the AI freezes, the process hangs, and the whole system crashes.

Most agents just blindly fire strings into standard child processes. This agent operates a persistent, interactive pseudo-terminal (PTY) inside a hardened Docker sandbox. It can write code, run tests, detect when a terminal is waiting for human input, and seamlessly answer those prompts completely on its own.

✨ Why This Agent is Different (The Hard Problems Solved)

Building an AI that writes code is easy. Building an infrastructure that safely executes and manages that code is incredibly hard. Here is how this project solves the toughest edge cases in AI systems engineering:

1. The Interactive PTY Engine

Instead of hitting the standard 4096-byte TTY limit or hanging on read -p, this agent uses a custom node-pty wrapper. It writes large AI-generated scripts to host-side files and sources them into a persistent bash session. If a command hangs waiting for input, a background heartbeat detects the idle prompt and hands the AI a send_input tool so it can type the answer and hit enter.

2. The "Symlink-Proof" Path Jail

LLMs hallucinate, and malicious code tries to escape. Standard string-matching directory checks (startsWith) are easily bypassed by symlink chains. This agent uses an iterative lstat and realpath resolver (safePath.ts) that walks the directory tree. It guarantees the AI cannot read your host's ~/.ssh keys or write new files outside the designated /workspace, even through dangling symlinks.

3. Curing "Context Amnesia"

Feeding a 200,000-character npm install log into an LLM will instantly blow out its context window. But if you just delete old messages to save space, the AI forgets what it just did. This system uses a dual-layer truncation strategy:

Middle-Out PTY Buffers: Drops the noise in the middle of massive terminal outputs, keeping the crucial head and tail (where the stack traces live).

Memory Stubbing: When the conversation history gets too long, the agent replaces its oldest tool outputs with a lightweight stub ([Tool output omitted...]), preserving its memory of the actions it took without the token bloat.

4. The "Prove It" Finish Gate

The AI is strictly forbidden from simply declaring a task "done." The tool handler tracks an internal isDirty state flag. If the AI edits a file, it must execute a bash command to test its work, and that command must return a clean 0 exit code before the system will allow the finish tool to execute.

🏗️ How the Engine Works

The architecture is split into three highly decoupled layers:

The Brain (agent.ts): A continuous ReAct (Reason + Act) loop powered by the Groq API (gpt-oss-120b). It manages the conversation window, handles 429 rate limit backoffs gracefully, and self-corrects JSON parsing errors.

The Hands & The Bouncer (handler.ts & safePath.ts): The tool executor. It exposes a strict API to the LLM (read, write, exact string replace, execute, interrupt). It enforces file security, timeouts, and the exit-code validation gate.

The Sandbox (dockerExecutor.ts): An ephemeral node:20-bookworm-slim Docker container. It spins up with dropped kernel capabilities (--cap-drop=ALL), a strict PID limit to prevent fork bombs, and a memory ceiling. It traps SIGINT (Ctrl+C) to ensure the container is perfectly scrubbed from your system even if you force-quit.

🛠️ The Agent's Toolbelt

The AI has access to the following toolkit to navigate the environment:

execute_command: Runs bash commands. Crucially, state (like cd and export) persists across turns.

send_input: The magic tool. Injects text into hanging, interactive processes.

interrupt: Sends Ctrl-C to abort runaway loops or prompts the AI doesn't know how to answer.

read_file: Reads files with pagination (start_line / end_line) to protect the context window.

write_file: Creates entirely new files.

str_replace: Safely edits code using exact string replacement (bypassing Node.js regex corruption bugs).

finish: Submits the final summary, but only if the workspace passes the automated test gate.

🚀 Getting Started

Prerequisites

Node.js (v18+)

Docker Desktop running locally

A Groq API Key for the LLM

Installation

Clone the repository:

git clone https://github.com/6eyeuser/Autonomous-Terminal-Agent.git
cd Autonomous-Terminal-Agent


Install dependencies:

npm install
npm i -D @types/node


Set your environment variables:

echo "GROQ_API_KEY=your_api_key_here" > .env


Firing it Up

Start the orchestration loop:

npx tsx run.ts


When the prompt appears, give the agent a challenge that forces it to interact with the shell, like:

"Write a bash script that prompts the user for their name, prints a greeting, and then run it. Wait for the script to block, and answer the prompt with the name 'Kartik'."

🛡️ Security Disclaimer

This agent is explicitly designed to execute untrusted, AI-generated code.

By default, it runs inside a Docker container with all kernel capabilities dropped and restricted limits.

The network is currently set to bridge so the agent can run npm install and apt-get.

If you do not need network access for your tasks, it is highly recommended to change network: "bridge" to network: "none" in run.ts for total air-gapped isolation.

Built with grit, TypeScript, and a lot of iterative lstat checks.
