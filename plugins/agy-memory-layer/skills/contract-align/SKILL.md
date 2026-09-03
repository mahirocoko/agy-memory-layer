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

> **Code Against a Frozen Contract**: `/contract-align` mutates source code against an existing, frozen contract. It never modifies `AGENTS.md` or `docs/**`. If a rule is found to be in conflict with the majority of the codebase, it is reported as a **Contract Finding** and routed to `/contract-refine`.

## When to Use

- When implementing or finishing a feature and wanting to ensure 100% compliance with repo patterns before review.
- When fixing AI drift (e.g. inline translation dictionaries, unextracted constants, `interface` instead of `type`, non-standard comments).
- When running a targeted audit on a route or component folder (e.g. `/contract-align app/routes/games`).

## Execution Workflow

### Phase 1: Contract Scope Resolution
Compile and evaluate the target files against the active contract:

```bash
node --experimental-strip-types "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts/contract-ledger.ts" eval <target-files...>
```

1. **Filter Active Rules**: Enforces only rules where `status: "current-reality"`. Rules marked as `preferred-direction` or `not-established` remain advisory and never generate code diffs.
2. **Deterministic Checks First**: Runs AST and syntax checks (strict `type` aliases, comment conventions, centralized constants) before engaging heuristic LLM review.

### Phase 2: Prose Overruling Code Protection (Majority Threshold)
To prevent the agent from blindly rewriting the entire codebase because of an idealistic rule in `AGENTS.md`:
- If > 50% of the scanned files violate a rule, `/contract-align` classifies it as a **Contract Finding**:
  > *"Rule X is violated by 35/40 files. In reality, this pattern is 'preferred-direction', not 'current-reality'. Route back to `/contract-refine`."*
- It generates code diffs **only for minority violations** where the established pattern is clearly proven by the rest of the codebase.

### Phase 3: Surgical Diff Generation
For genuine code findings, generate minimal, focused diffs:
1. **Centralized Constants & i18n**: Extract inline label dictionaries to `constants/*` wrapped in repo-standard translation descriptors (`msg`).
2. **Strict Type Aliases**: Replace `interface` declarations with `export type Foo = { ... }`.
3. **Comment Hygiene**: Normalize ad-hoc comments to the repository's recognized tags.
4. **Theme Primitive Composition**: Ensure components compose system UI primitives rather than ad-hoc inline styles.

### Phase 4: Review-First Human Gate
Present findings and proposed diffs to the user:
- Show exact line numbers, rule IDs, and rationale.
- Run `pnpm check` and tests to verify zero regressions.
- **Never auto-commit.** Await explicit user approval before applying changes.
