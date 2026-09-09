---
name: contract-align
description: >-
  Evaluate and refactor target code files against the repository's active, compiled contract ledger.
  Generates surgical diffs without prose overruling code or duplicate linter work.
  Trigger on /contract-align, /contract-align <files...>, or /code-align.
---

# /contract-align — Code Contract Enforcer & Safe Refactorer

Audits and refactors source code files to strictly conform with the repository's active contract (`AGENTS.md`, `docs/**`, and MemFS project conventions). Serves as the code-enforcement counterpart to `/contract-refine`.

## Operating Invariant

> **Code Against a Frozen Contract**: `/contract-align` mutates source code against an existing, frozen contract. It never modifies `AGENTS.md` or `docs/**`. If a rule is found to be in conflict with the majority of the codebase, it is reported as a **Contract Finding** with diffs suppressed and routed to `/contract-refine`.

## When to Use

- When implementing or finishing a feature and wanting to ensure compliance with repo patterns before review.
- When fixing AI drift (e.g. inline translation dictionaries, unextracted constants, `interface` instead of `type`, non-standard comments).
- When running a targeted audit on a route or component folder (e.g. `/contract-align app/routes/games`).

## Execution Workflow

### Phase 0: Target Resolution
Resolve modified and untracked code files reliably:

```bash
git diff --name-only --diff-filter=ACMR HEAD && git ls-files --others --exclude-standard
```

Avoid `git status -s | awk '{print $2}'` which breaks on renames and includes deleted paths.

### Phase 1: Deterministic Evaluation & Coverage Scope
Evaluate target files against active contract rules using `contract-ledger.ts`:

```bash
node --experimental-strip-types "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts/contract-ledger.ts" eval --json <target-files...> > /tmp/eval.json
```

1. **Rule Coverage Accounting**: The CLI reports exact coverage (`ratio = evaluated / (evaluated + unevaluated)`).
2. **Hard Gate on Exit Code 3 / 4**:
   - **Exit 0**: Clean pass AND full deterministic rule coverage (`ratio === 1.0`).
   - **Exit 1**: Deterministic contract violations found. Stop and fix.
   - **Exit 3 (`REVIEW_REQUIRED`)**: Evaluated deterministic rules passed, but unevaluated heuristic/architectural rules remain. **No compliance claim may be made.** The agent MUST proceed to Phase 2.
   - **Exit 4 (`CONTRACT_DISPUTE`)**: Majority violation on spoke rule detected. Diffs suppressed; route to `/contract-refine`.

> [!CAUTION]
> Never pass `--deterministic-only` during `/contract-align`. Bypassing the Exit 3 gate skips heuristic review and prematurely masks architectural or spoke violations.

### Phase 2: Heuristic Model Review & Verdict Enforcement (Pure Conductor)
For every rule in `coverage.unevaluated` whose scope intersects target files:
1. Review modified files against the unverified rules using "claims to disprove".
2. Save findings to `/tmp/review.json`:
   ```json
   {
     "assessedBy": "model-reviewer",
     "reviews": [
       { "ruleId": "<id>", "verdict": "pass" | "violation" | "not-applicable", "rationale": "..." }
     ]
   }
   ```
3. Run the mechanical verdict gate:
   ```bash
   node --experimental-strip-types "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts/contract-ledger.ts" verdict --eval /tmp/eval.json --review /tmp/review.json
   ```
   The tool mechanically refuses to emit `ALIGNED` if any unevaluated rule lacks a review verdict, if any violation is reported, or if the eval verdict was not clean.

### Phase 3: Surgical Diff Generation
For genuine code findings (confirmed deterministic or heuristic violations):
1. **Centralized Constants & i18n**: Extract inline label dictionaries to `constants/*` wrapped in repo-standard translation descriptors.
2. **Strict Type Aliases**: Replace `interface` declarations with `export type Foo = { ... }`.
3. **Route Thinness & Delegation**: Extract heavy JSX trees from route files to `components/modules/*`.
4. **Primitive Composition**: Remove ad-hoc class overrides from Base UI primitives.

### Phase 4: Re-Verification & Review-First Human Gate
1. **Re-Evaluation**: After applying surgical diffs, re-run Phase 1 (`eval`) and Phase 2 (`verdict`) to verify that violations were resolved without regressions.
2. **Present Findings**: Present findings and proposed diffs to the user:
   - Show exact line numbers, rule IDs, and rationale.
   - Report exact evaluation counts: `N rules assessed (D deterministic, H heuristic)`.
   - **Banned Phrasing**: Never use `"100%"`, `"fully compliant"`, `"all invariants"`, or `"ตรงตามเป๊ะ"`. Scope every pass strictly to the evidence evaluated.
   - Run `pnpm check` and tests to verify zero regressions.
   - **Never auto-commit.** Await explicit user approval before applying changes.
