#!/usr/bin/env bash
set -e

# Read JSON payload from stdin
STDIN_INPUT=$(cat)

# Extract first workspace path using node or jq
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

MEMORY_ROOT="${HOME}/.gemini/memory"
GLOBAL_HUMAN="${MEMORY_ROOT}/global/human.md"
GLOBAL_PERSONA="${MEMORY_ROOT}/global/persona.md"

PROJECT_SLUG=$(basename "$WORKSPACE_PATH" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
PROJECT_MEM="${MEMORY_ROOT}/projects/${PROJECT_SLUG}/project.md"
PROJECT_RULES="${MEMORY_ROOT}/projects/${PROJECT_SLUG}/rules.md"

# Build ephemeral memory context
CONTEXT_TEXT=""

if [ -f "$GLOBAL_HUMAN" ]; then
  HUMAN_CONTENT=$(cat "$GLOBAL_HUMAN")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 👤 User Profile & Preferences (global/human.md)\n${HUMAN_CONTENT}\n\n"
fi

if [ -f "$PROJECT_MEM" ]; then
  PROJ_CONTENT=$(cat "$PROJECT_MEM")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 📁 Project Context (${PROJECT_SLUG}/project.md)\n${PROJ_CONTENT}\n\n"
fi

if [ -f "$PROJECT_RULES" ]; then
  RULES_CONTENT=$(cat "$PROJECT_RULES")
  CONTEXT_TEXT="${CONTEXT_TEXT}### 📋 Project Rules (${PROJECT_SLUG}/rules.md)\n${RULES_CONTENT}\n\n"
fi

# Output JSON to stdout for AGY PreInvocation hook
if [ -n "$CONTEXT_TEXT" ]; then
  node -e '
    const text = process.argv[1];
    const message = `🧠 **[MemFS Active Memory]**\n\n` + text;
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
