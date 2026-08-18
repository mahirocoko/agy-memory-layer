# Local Episodic Recall Instructions

Search historical conversation transcripts on disk without requiring cloud dependencies.

## Data Source
Antigravity stores conversation transcripts as JSON Lines at:
`~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`

## Execution
Run the local recall engine:
```bash
node plugins/agy-memory-layer/scripts/recall-engine.js search "<query>"
```

## Strategy
1. Search across recent transcripts using keywords.
2. Return ranked results with dates, conversation IDs, speaker role, and relevant quotes.
3. Formulate a direct answer with clickable conversation markdown links `[conv-<id>](conversation://<id>)`.
