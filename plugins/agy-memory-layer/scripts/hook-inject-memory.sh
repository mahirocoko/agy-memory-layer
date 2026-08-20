#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Prefer cross-platform TypeScript / Node implementation if available
if [ -f "${SCRIPT_DIR}/hook-inject-memory.ts" ]; then
  exec node --experimental-strip-types "${SCRIPT_DIR}/hook-inject-memory.ts"
elif [ -f "${SCRIPT_DIR}/hook-inject-memory.js" ]; then
  exec node "${SCRIPT_DIR}/hook-inject-memory.js"
fi

# Fallback POSIX execution
STDIN_INPUT=$(cat)
WORKSPACE_PATH=$(echo "$STDIN_INPUT" | node -e '
  try {
    const fs = require("fs");
    const input = JSON.parse(fs.readFileSync(0, "utf-8"));
    const ws = (input.workspacePaths && input.workspacePaths.length > 0) ? input.workspacePaths[0] : process.cwd();
    process.stdout.write(ws);
  } catch (e) {
    process.stdout.write(process.cwd());
  }
')

MEMORY_ROOT="${AGY_MEMORY_DIR:-${HOME}/.gemini/memory}"
GLOBAL_HUMAN="${MEMORY_ROOT}/global/human.md"
GLOBAL_PERSONA="${MEMORY_ROOT}/global/persona.md"

PROJECT_SLUG=$(node -e '
  const path = require("path");
  const fs = require("fs");
  const execSync = require("child_process").execSync;
  const ws = process.argv[1] || process.cwd();
  const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || "", ".gemini", "memory");
  const memProjectsDir = path.join(memoryRoot, "projects");
  const basenameSlug = path.basename(ws).toLowerCase().replace(/\s+/g, "-");

  if (fs.existsSync(path.join(memProjectsDir, basenameSlug))) {
    process.stdout.write(basenameSlug);
    process.exit(0);
  }

  try {
    const remote = execSync("git config --get remote.origin.url", {
      cwd: ws,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (remote) {
      const match = remote.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/);
      if (match) {
        const canonical = `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        if (fs.existsSync(path.join(memProjectsDir, canonical))) {
          process.stdout.write(canonical);
          process.exit(0);
        }
      }
    }
  } catch (e) {}

  process.stdout.write(basenameSlug);
' "$WORKSPACE_PATH")
PROJECT_MEM="${MEMORY_ROOT}/projects/${PROJECT_SLUG}/project.md"
PROJECT_RULES="${MEMORY_ROOT}/projects/${PROJECT_SLUG}/rules.md"

CONTEXT_TEXT=""

if [ -f "$GLOBAL_HUMAN" ]; then
  HUMAN_CONTENT=$(cat "$GLOBAL_HUMAN")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 👤 User Profile & Preferences (global/human.md)\n${HUMAN_CONTENT}\n\n"
fi

if [ -f "$GLOBAL_PERSONA" ]; then
  PERSONA_CONTENT=$(cat "$GLOBAL_PERSONA")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 🤖 Agent Persona (global/persona.md)\n${PERSONA_CONTENT}\n\n"
fi

if [ -f "$PROJECT_MEM" ]; then
  PROJ_CONTENT=$(cat "$PROJECT_MEM")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 📁 Project Context (${PROJECT_SLUG}/project.md)\n${PROJ_CONTENT}\n\n"
fi

if [ -f "$PROJECT_RULES" ]; then
  RULES_CONTENT=$(cat "$PROJECT_RULES")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 📋 Project Rules (${PROJECT_SLUG}/rules.md)\n${RULES_CONTENT}\n\n"
fi

if [ -n "$CONTEXT_TEXT" ]; then
  node -e '
    const text = process.argv[1];
    const estTokens = Math.ceil(text.length / 4);
    let reminder = "";
    if (estTokens > 1200) {
      reminder = `\n> 💡 *[MemFS Budget Notice: Injected memory is ~${estTokens} tokens. Run /dream or /doctor to consolidate if needed.]*\n`;
    }
    const message = `🧠 **[MemFS Active Memory]**\n\n` + text + reminder;
    const output = {
      injectSteps: [
        {
          ephemeralMessage: message
        }
      ]
    };
    process.stdout.write(JSON.stringify(output));
  ' "$CONTEXT_TEXT"
else
  echo '{"injectSteps": []}'
fi
