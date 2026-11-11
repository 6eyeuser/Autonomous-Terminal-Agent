```markdown
# 🤖 Autonomous Docker Terminal Agent

Welcome to the Autonomous Docker Terminal Agent.

If you've ever played with open-source AI coding assistants, you know their dirty little secret: the moment a bash script asks `Do you want to continue? [y/N]` or prompts for a password, the AI freezes, the process hangs, and the whole system crashes.

Most agents just blindly fire strings into standard child processes. This agent operates a persistent, interactive pseudo-terminal (PTY) inside a hardened Docker sandbox. It can write code, run tests, detect when a terminal is waiting for human input, and seamlessly answer those prompts completely on its own.

## ✨ Why This Agent is Different (The Hard Problems Solved)

Building an AI that writes code is easy. Building an infrastructure that safely executes and manages that code is incredibly hard. Here is how this project solves the toughest edge cases in AI systems engineering:

* **The Interactive PTY Engine:** Instead of hitting the standard 4096-byte TTY limit or hanging on `read -p`, this agent uses a custom `node-pty` wrapper. It writes large AI-generated scripts to host-side files and `source`s them into a persistent bash session. If a command hangs waiting for input, a background heartbeat detects the idle prompt and hands the AI a `send_input` tool so it can type the answer and hit enter.
* **The Symlink Path Jail:** LLMs hallucinate. If an AI tries to write a file to `../../etc/passwd` or uses a dangling symlink to escape the workspace, the system stops it. The file handler uses iterative `lstat` and `realpath` resolution to guarantee the AI cannot break out of the `/workspace` directory, closing all symlink jailbreaks.
* **The Amnesia Fix:** Standard agents pass the entire terminal output back to the LLM. One noisy `npm install` and the context window is blown, causing the AI to forget the original goal. This agent buffers up to 220k characters but aggressively truncates it before it hits the API. Furthermore, old tool outputs are replaced with lightweight stubs, allowing the agent to remember the *actions* it took without crashing the token limit.
* **The Finish Gate:** The AI is mathematically forbidden from calling it quits until it proves its work. The `finish` tool is locked until the agent runs a test command that returns a clean `0` exit code.

## 🏗️ Architecture

The system is built on a continuous **ReAct (Reason + Act)** loop powered by TypeScript, Node.js, and the Groq API (`gpt-oss-120b`).

1. **The Sandbox (`DockerSentinelExecutor`):** Ephemeral Docker containers (`node:20-bookworm-slim`) spun up with `--cap-drop=ALL` and restricted PIDs.
2. **The Execution Engine (`PtyShellExecutor`):** A persistent bash session that maintains state (`cd`, env vars) across turns. It captures exact exit codes using a randomized `__DONE_UUID__:$?` sentinel.
3. **The LLM Orchestrator:** Manages the context window, handles 429 exponential backoffs, and recovers from JSON parsing errors by injecting nudges back into the prompt.

## 🛠️ The Tool Arsenal

* `execute_command`: Runs bash commands (state persists).
* `send_input`: Injects text into hanging, interactive processes.
* `interrupt`: Sends `Ctrl-C` to abort hanging loops.
* `read_file`: Reads files (supports pagination).
* `write_file`: Creates entirely new files.
* `str_replace`: Edits code using exact string replacement (bypassing Node's `$$` regex variable corruption bug).
* `finish`: Submits the final summary (blocked if unverified).

## 💻 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Docker Desktop](https://www.docker.com/) running locally
* A [Groq API Key](https://console.groq.com/)

### Setup
1. Clone the repository:
   ```bash
   git clone [https://github.com/6eyeuser/Autonomous-Terminal-Agent.git](https://github.com/6eyeuser/Autonomous-Terminal-Agent.git)
   cd Autonomous-Terminal-Agent

```

2. Install dependencies:
```bash
npm install

```


3. Set your environment variables:
```bash
echo "GROQ_API_KEY=your_api_key_here" > .env

```



### Running the Agent

```bash
npx tsx run.ts

```

When prompted, give the agent a complex objective, such as:

> *"Write a bash script that prompts the user for their name, prints a greeting, and then run it and answer the prompt with 'Kartik'."*

---

*Built by Kartik.*

```

```
