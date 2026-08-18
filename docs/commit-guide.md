# Commit & Review Guide — `agy-memory-layer`

This guide specifies the non-negotiable commit rules, review workflow, and release hygiene for this repository.

---

## 🚫 Non-Negotiable Safety Rules

1. **Never Commit Automatically**:
   - Every commit requires prior user inspection.
   - Run `npm test`, display `git status --short`, and present diffs (`git diff --stat`) before asking or waiting for commit approval.
2. **Never Push to Remote Automatically**:
   - `git push` is strictly forbidden unless the user explicitly orders a push in their prompt.
3. **No Amend on Shared Commits**:
   - Always create a new clean commit instead of amending.
4. **No Artificial Intelligence Attribution**:
   - Never include AI signatures, bot trailers, or `Co-authored-by` AI tags in commit messages.

---

## 📝 Commit Message Convention

Format all commit messages according to Conventional Commits:

`<type>(<scope>): <short description>`

### Standard Types:
- `feat`: New subagent, hook feature, recall mode, or palace UI component
- `fix`: Bug fix in token calculation, hook execution, or manifest resolution
- `docs`: Documentation updates (`README.md`, `docs/`, `CONTRACT.md`)
- `test`: New test scenarios or test harness enhancements
- `chore`: Version bumps, dependency updates, or asset reorganization

### Examples:
- `feat: add 20-step count auto-dream trigger and background async hook`
- `fix(palace): align brand badge version to v1.5.1 and update test report`
- `docs(readme): optimize image widths and subagent table layout for GitHub rendering`
