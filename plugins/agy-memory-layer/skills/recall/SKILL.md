---
name: recall
description: Search and recall messages, decisions, code snippets, and topics discussed across all past Antigravity conversation sessions.
---

# /recall - Episodic Conversation Recall

Search and retrieve past discussions, user instructions, bug fixes, and architectural decisions across all historical Antigravity conversation transcripts.

## Usage
- `/recall <query>` — Default Hybrid search (combines exact keywords + vector semantic similarity).
- `/recall search "<query>" --semantic` — Pure Vector Semantic similarity (finds concepts and synonyms).
- `/recall search "<query>" --keyword` — Exact keyword matching.
- `/recall list` — View a list of recent conversation sessions and their starting prompts.

## Examples
- `/recall palace token calculation`
- `/recall search "database migration setup" --semantic`
- `/recall list`

## Execution
```bash
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts"
node "$SCRIPT_DIR/recall-engine.js" "$@"
```
