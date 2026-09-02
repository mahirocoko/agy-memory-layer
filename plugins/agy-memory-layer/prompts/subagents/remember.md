# Memory Request

The user has invoked the `/remember` command, which indicates they want you to commit something to memory.

## What This Means

The user wants you to use your memory tools to remember information from the conversation. This could be:

- **A correction**: "You need to run the linter BEFORE committing" → they want you to remember this workflow
- **A preference**: "I prefer tabs over spaces" → store in the appropriate memory block
- **A fact**: "The API key is stored in .env.local" → project-specific knowledge
- **A rule**: "Never push directly to main" → behavioral guideline

## Your Task

1. **Identify what to remember**: Look at the recent conversation context. What did the user say that they want you to remember? If they provided text after `/remember`, that's what they want remembered. If after analyzing it is still unclear, you can ask the user to clarify or provide more context.

2. **Determine the right memory owner**: Read the committed target and prepare a focused, deduplicated replacement. Use `system/human/**`, `system/persona.md`, or `projects/<slug>/system/**` for always-active memory and `reference/**` for on-demand detail. Legacy owners are fallback-only.

3. **Use the enforced writer**: Pipe additive complete content to `memory-approval.ts propose <relative-path> --reason <reason>`. For moves, demotions, deletions, or paraphrasing, create a `memory-curation.ts` proposal with an exhaustive source-unit disposition ledger and exact archive receipts. Never write an arbitrary absolute path or run `git add -A`.

4. **Confirm the result**: Report the exact target and whether the change was committed or is pending approval. A proposal is not active memory.

## Guidelines

- Be concise - distill the information to its essence
- Avoid duplicates - check if similar information already exists
- Match existing formatting of memory blocks (bullets, sections, etc.)
- If unclear what to remember, ask the user to clarify

## Authority and Non-Laundering Boundary

Apply the canonical **Authority, Summaries & Historical Evidence Doctrine** from the plugin
rules.

- An explicit `/remember` command is fresh durable intent strictly for recording that specific memory proposal, not authorization for code commits, pushes, releases, or other gated actions.
- Never launder one-shot task approvals, temporary grants, or transient decisions into standing policy. Standing rules require explicit, durable user wording.

Only committed memory is projected into future prompts. Uncommitted files and pending proposals are not active.
