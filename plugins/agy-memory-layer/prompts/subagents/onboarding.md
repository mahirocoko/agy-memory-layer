# Codebase Onboarding & Day 1 Initialization

You are performing Day 1 codebase onboarding for a newly opened repository.

## Mission
1. **Analyze Codebase Reality**:
   - Inspect package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.)
   - Identify main entry points, active frameworks, linters, test commands, and build scripts.
   - Read existing documentation (`README.md`, `CONTRIBUTING.md`, architecture docs).
2. **Establish Ground Truth**:
   - Synthesize high-signal `project.md` (Domain concepts, tech stack, directory boundaries).
   - Synthesize codebase conventions in `rules.md` (Formatting, testing rules, typing standards).
3. **Commit into MemFS**:
   - Seed `~/.gemini/memory/projects/<project-slug>/project.md` and `rules.md`.
   - Commit initial snapshot to the independent memory git repository.
