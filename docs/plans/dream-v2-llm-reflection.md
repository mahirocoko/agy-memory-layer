# Dream v2: LLM-Backed Reflection — Design Plan

> **Status:** Proposed  
> **Scope:** `plugins/agy-memory-layer/scripts/dream-daemon.ts` + new `dream-reflector.ts`  
> **Prerequisite:** #2 ✅ #3 ✅ #4 ✅ (path alignment, statusline, recall self-match)

---

## Problem

Current dream (`dream-daemon.ts`) uses **deterministic regex** to extract durable-memory intent:
- Only catches explicit phrases: `always remember`, `จำไว้`, `from now on`, etc.
- **Misses implicit corrections** — e.g. "ugh, again with the long explanation…" (a preference that all 6 tested models recognized)
- Writes only to `archives/` (recall-only) — **never updates active memory**
- No model involved = zero synthesis, zero consolidation, zero contradiction resolution

## Design: cursor-memory-layer Proven Pattern

Based on real A/B testing across 6 models on a hard scenario:

### Architecture

```
┌─────────────────────────────────────┐
│          dream-daemon.ts            │
│  (orchestrator — same as today)     │
│                                     │
│  1. Scan transcripts (existing)     │
│  2. Extract unreflected slice       │
│  3. Call dream-reflector.ts (NEW)   │
│  4. Route proposals → approval flow │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│        dream-reflector.ts (NEW)     │
│  Tool-less JSON reflector prompt    │
│                                     │
│  Input:                             │
│  - Memory snapshot (≤40k chars)     │
│  - Unreflected transcript slice     │
│    (≤60k chars)                     │
│                                     │
│  Output (strict JSON):             │
│  {                                  │
│    "summary": "...",                │
│    "operations": [                  │
│      { "op": "write",              │
│        "path": "...",              │
│        "description": "...",       │
│        "body": "..." },            │
│      { "op": "delete",             │
│        "path": "..." }             │
│    ]                                │
│  }                                  │
│  Max 8 operations per run           │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│      memory-approval.ts (existing)  │
│  Route proposals through Agy's      │
│  human-approval flow                │
│  (preserves user-approval invariant)│
└─────────────────────────────────────┘
```

### Key Design Decisions

#### 1. Tool-less Reflector (from cursor-memory-layer)
- Reflector model gets **NO tools** — only memory snapshot + transcript → strict JSON output
- This prevents runaway hallucinations, unauthorized file actions, invented commands
- cursor-memory-layer proved this is the safest pattern

#### 2. Model Tier: opus-4.6 primary, gemini-4.8-high fallback
- cursor-memory-layer A/B test showed weak/small models invent commands not in the transcript
- **Primary:** `opus-4.6` (Mahiro's active Agy model — strong reasoning, safe for reflection)
- **Fallback:** `gemini-4.8-high` (when opus hits usage limits)
- Make model configurable in `dream-state.json`; reject nano/flash/composer tiers

#### 3. Strict Prompt Rules (from cursor-memory-layer lessons)
- Record commands/ports/paths **exactly as shown** in transcript
- **Never derive new commands** — if it wasn't typed, don't record it
- Remove unknown wrong parts instead of guessing
- Prefer updating existing file over creating new one
- Max 8 operations per reflection run

#### 4. Route Through Existing Approval Flow
- Unlike cursor-memory-layer (which auto-commits), Agy routes through `memory-approval.ts`
- This **preserves our human-approval invariant** — stronger safety than Letta or cursor
- User reviews diff → approves → commit
- Fallback: archive-only mode (current behavior) if approval is declined

#### 5. Safety Guards

| Guard | Source | Implementation |
|---|---|---|
| Anti-loss (`assertKeepsExistingLines`) | cursor-memory-layer | Reject writes dropping >50% of existing lines |
| Snapshot race detection | cursor-memory-layer | Reject if memory HEAD advanced since snapshot |
| Protected paths | agy-memory-layer | Block writes to `archives/`, `read_only` files |
| Atomic rollback | Both | Git checkout rollback on any failure |
| Operation cap | cursor-memory-layer | Max 8 ops per run |

### Implementation Phases

#### Phase 1: Core Reflector (new file)
- [ ] Create `scripts/dream-reflector.ts`
- [ ] Implement `buildReflectionPrompt(memorySnapshot, transcriptSlice)` 
- [ ] Implement `parseReflectionResponse(json)` with strict schema validation
- [ ] Implement `assertKeepsExistingLines(proposed, existing)` anti-loss guard
- [ ] Unit tests for prompt building, response parsing, anti-loss guard

#### Phase 2: Wire into dream-daemon
- [ ] Add `--llm` flag to dream-daemon CLI (opt-in, regex remains default)
- [ ] Extract unreflected transcript slice (respecting conversation cursor)
- [ ] Capture memory snapshot at reflection start (for race detection)
- [ ] Call reflector → validate response → check snapshot race
- [ ] Route validated operations through `memory-approval.ts`
- [ ] Fallback to archive-only on approval decline or model failure

#### Phase 3: Integration & Safety
- [ ] Model configuration in `dream-state.json` (`reflectionModel`, `reflectionEnabled`)
- [ ] Exponential backoff on reflection failures (from cursor-memory-layer `isBackedOff`)
- [ ] Statusline integration: `↻N` shows both regex and LLM dream counts
- [ ] Update SKILL.md with `--llm` flag documentation
- [ ] Integration test: mock model response → approval → commit verification

#### Phase 4: Activation (deferred until Phase 1-3 verified)
- [ ] Per-conversation cursor tracking (`reflectedThroughStep`)
- [ ] One-active-run reservation (from Letta)
- [ ] Optional cron schedule with `--llm` mode
- [ ] Consider isolated worktree for reflection writes

### Model Configuration

Desired Dream v2 route, not wired: **Opus 4.6 primary**, **Gemini 4.8 High fallback**. Do not implement this routing in the current change, and do not silently substitute a Gemini 3.x catalog id for the fallback.

A fresh `agy models` check on 2026-09-26 listed `claude-opus-4-6-thinking` and did not list `gemini-4.8-high`. The visible Gemini tiers were 3.8, 3.7, and 3.6 Flash plus 3.1 Pro. Fallback availability therefore requires another catalog check before Dream v2 activation. This JSON remains the desired configuration, not a live model binding.

```json
// dream-state.json
{
  "reflectionEnabled": false,
  "reflectionModel": "opus-4.6",
  "reflectionFallbackModel": "gemini-4.8-high",
  "reflectionMaxOps": 8,
  "reflectionMemoryBudget": 40000,
  "reflectionTranscriptBudget": 60000,
  "lastDreamedSteps": { ... }
}
```

### What We Keep from Current Dream
- ✅ Deterministic regex extraction (fast, zero-cost, always-on)
- ✅ Archive-only output for regex matches
- ✅ Step-count trigger (`checkAndAutoDreamOnStepCount`)
- ✅ Cross-project execution
- ✅ State persistence in `dream-state.json`
- ✅ Two-phase lock pattern

### What Changes
- 🆕 Optional LLM pass (`--llm`) alongside regex
- 🆕 LLM proposals route through `memory-approval.ts` (not auto-commit)
- 🆕 Anti-loss and race guards
- 🆕 Model tier requirement and configuration
- 🆕 Backoff on failure

### Open Questions
1. **Model provider:** Use Agy's configured model or a separate API key for reflection?
2. **Cost:** LLM reflection has token cost — should it be gated by step count (e.g. only after 50+ steps)?
3. **Prompt language:** Should reflection prompt be English-only or support Thai extraction?
4. **Batch vs single:** Process all unreflected conversations in one LLM call or one per conversation?

---

## Prerequisite: Active-memory notice threshold (separate from Dream v2)

> **Source:** Current Agy source (`hook-inject-memory.ts`, `tools/memory-health.ts`) outranks the earlier plan wording. The 4,000-character per-file and 24,000-character aggregate figures came from Cursor memory-layer history. They are not an Agy injection ceiling.

Dream v2 Phases 1–4 stay deferred. Do not implement `dream-reflector.ts` for this prerequisite.

### Verified Agy contract
- Current source has no 4,000-character per-file injection ceiling and no 24,000-character aggregate injection ceiling. There is no `memory-config.ts` size ceiling and no Doctor `checkSize` character gate to remove.
- `ACTIVE_MEMORY_BUDGET_TOKENS` is a runtime notice and a strict offline Doctor/health gate. It does not drop active content. It is not proof that the Agy host delivered a single message intact.
- The threshold is **32,000** estimated tokens, raised from 1,400. Above it, PreInvocation still emits the full active projection and puts a `/doctor` notice on the final transport step. Deterministic `/dream` does not consolidate that projection. Raising the threshold does not by itself deliver full memory: a disposable Agy 1.2.11 / Opus 4.6 session received one 100,098-character hook message as a single `EPHEMERAL_MESSAGE`. The host omitted bytes and recorded `<truncated 51851 bytes>` around the end of `coding.md`. The coding tail was visible and a workflow tail rule was NOT VISIBLE.
- Active content is packed into ordered inject steps of at most 40,000 UTF-8 bytes. Empty memory stays one authority-only step. The authority stanza stays on the first step. Chunks prefer newline and document boundaries; one oversized document is split on Unicode code points without dropping, duplicating, or inserting replacement characters. Budget accounting uses the aggregate payload before chunking and excludes the authority stanza, chunk labels, header, and notice. A follow-up Agy 1.2.11 / Opus 4.6 probe received five ordered messages of 1,871, 38,280, 15,503, 38,911, and 6,434 UTF-8 bytes without a transcript truncation marker; the model quoted unique tail rules from both `coding.md` and `workflow.md`. This verifies the current bounded fixture, not every future host version. There is still no per-file content ceiling.
- `/doctor` and `memory-health.ts --strict` fail when a projection exceeds the threshold. Doctor does not automatically rewrite active files.
- Current live Agy summary files were created by approved curation. Replacing those summaries is a separate pass through the existing provenance-preserving curation flow (`memory-curation.ts`).
- The portable preference source for that curation comes from the current Mahiro Code/Letta system preference owners, but runtime-specific model/delegation prose must be adapted rather than copied byte-for-byte. Current Agy truth is owned by a focused `system/agy-runtime-routing.md`, live `agy models`, the installed agent manifests, and Evidence Controller. `~/.gemini/memory/reference/letta-system` does not exist and is not a source path.
- A live Agy 1.2.11 / Opus 4.6 probe defined and invoked a native read-only `flash` child (`c5c015f9-b9a4-46cd-9f49-abbdcd6de54d`) that verified both version owners as `1.21.0`. The exact resolved child model ID and adversarial host enforcement of declared tool restrictions remain unverified. Herdr parent state stayed `done`; a wait restricted to `idle|blocked` timed out after the report existed, so lifecycle state alone is not completion proof.

### Source status
1. [x] Raise `ACTIVE_MEMORY_BUDGET_TOKENS` from 1,400 to 32,000 in `hook-inject-memory.ts`
2. [x] Point the budget notice at `/doctor` without claiming the host left the message untruncated
3. [x] Prove the exact token boundary in the direct budget tests
4. [x] Pack active injection into ordered transport steps of at most 40,000 UTF-8 bytes
5. [x] Prove current Agy host delivery with unique tail rules from separate transport steps
6. [x] Prepare and disposable-test an Agy-adapted curation: 24 prior units retained exactly, 5 superseded absolute rules archived, all 14 current model IDs captured, native subagents preferred, and direct-cli scoped to real external capability/session needs
7. [x] Apply the fresh human-approved live curation at MemFS commit `1726af9973a61e46608995c428848fb4432aa955` with plan hash `b98f341c20f1835b89ff5ccef28be9586921ba85c18ad65f925a644a7a578970`; strict live health is clean at 24,603 / 32,000 estimated tokens, and a fresh Agy 1.2.11 / Opus 4.6 session recovered the native/direct/external route plus the Haabiz, reusable-skill, nested-repo, and tier-identity constraints from injected memory without tools

### Not part of this change
- Do not invent a per-file character limit.
- Do not start Dream v2 phases or add `dream-reflector.ts`.
- Do not implement Dream v2 reflection model routing. Its desired route stays Opus 4.6 primary and Gemini 4.8 High fallback, with a fresh `agy models` check before activation. The focused Agy runtime owner documents current execution routing separately and explicitly records that `gemini-4.8-high` is absent from the current catalog.

---

> **Next session:** The Agy-adapted live curation prerequisite is complete. Dream v2 phases remain deferred; start Phase 1 only from the current Agy model catalog and the separate desired reflection-route gate above.
