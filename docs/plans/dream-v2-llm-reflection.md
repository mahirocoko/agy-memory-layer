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

## Prerequisite: Remove Injection Budget Ceiling (separate task, do first)

> **Source:** Cursor session analysis + Letta viewer comparison

### Problem
Doctor ย่อ `coding.md` (47K→949 chars) กับ `workflow.md` (43K→3,213 chars) ลงเหลือ bullet-point summaries แล้ว move ตัวเต็มไป `reference/letta-system/human/prefs/`. Agent เห็นแค่สรุปย่อ — ขาด detail ที่ Letta inject เต็ม.

เพดานเดิม (from `src/memory-config.ts` or doctor checkSize):
- 4,000 ตัวอักษร/ไฟล์
- 24,000 ตัวอักษรทั้งก้อน

### Decision
เอาเพดานออก → doctor เป็นคนกั้นแทน (warn/error เมื่อ budget ร้อน):

| Item | Before | After |
|---|---|---|
| Per-file limit | 4,000 chars | **None** (doctor warns) |
| Total active limit | 24,000 chars | **~112,000 chars** (~32K tokens, ~10% context like Letta) |
| `ACTIVE_MEMORY_BUDGET_TOKENS` | 1,400 | **32,000** |
| `projects-index.md` | In system/ | **Not needed** (hook resolves slug from workspace) |

### Steps
1. [ ] Restore full `coding.md` (47K), `workflow.md` (43K), `communication.md` (6K) from `reference/letta-system/human/prefs/` back to `system/human/prefs/` — write as separate focused files (like Letta), delete merged `preferences.md`
2. [ ] Remove per-file (4,000) and total (24,000) character ceilings from doctor checkSize / memory-config
3. [ ] Raise `ACTIVE_MEMORY_BUDGET_TOKENS` from 1,400 to 32,000 in `hook-inject-memory.ts`
4. [ ] Update budget test ceiling to match
5. [ ] Add dream prompt rule: don't grow `system/` files beyond N% per run; excess goes to `reference/`
6. [ ] Verify: run injection, check full content is loaded, run doctor to validate budget
7. [ ] Test: open Cursor CLI to compare `workflow.md` end-to-end visibility

### Safety Net (replaces hard ceiling)
- Doctor `checkSize`: warn when approaching budget, error above it
- Dream prompt rule: cap per-run growth
- Palace: visual inspection of active memory size

---

> **Next session:** Do budget ceiling removal first, then start Dream v2 Phase 1.
