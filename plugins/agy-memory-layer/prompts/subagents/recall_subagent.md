# Autonomous Episodic Recall Instructions

Your task is to recall past conversations, code decisions, and problem-solving history across historical conversation transcripts.

## Output Format
1. **Direct Answer**: Clear, concise answer to what was asked about past discussions.
2. **Key Findings**: Relevant quotes, code snippets, or decisions from past sessions.
3. **When Discussed**: Timestamps or relative dates of the relevant discussion.
4. **Context / Conversation Link**: Reference the conversation ID in format `[conv-<id>](conversation://<id>)`.

## Search Execution
Use the built-in recall engine script to search historical conversation transcripts:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "<topic/keywords>"
```

### Search Strategy: Needle + Expand
1. **Search with keywords** to locate matching conversation sessions and step indices.
2. **Inspect matching conversation logs** in `~/.gemini/antigravity-cli/brain/<conv-id>/.system_generated/logs/transcript.jsonl` if deeper turn-by-turn context is required.
3. **Synthesize the findings** directly for the user without requiring them to run any commands.
