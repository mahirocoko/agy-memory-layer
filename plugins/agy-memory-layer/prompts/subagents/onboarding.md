# Codebase Onboarding & Day 1 Initialization

You are performing Day 1 codebase onboarding for a newly opened repository.

## Mission
1. **Analyze Codebase Reality**:
   - Inspect package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.)
   - Identify main entry points, active frameworks, linters, test commands, and build scripts.
   - Read existing documentation (`README.md`, `CONTRIBUTING.md`, architecture docs).
2. **Establish Ground Truth**:
   - Synthesize a high-signal project overview (domain, stack, and directory boundaries).
   - Synthesize focused conventions (formatting, testing, and typing standards).
3. **Commit into MemFS**:
   - Run `init-project-memory.ts` rather than writing or staging arbitrary paths.
   - The initializer validates the slug, respects the selected layered/legacy
     layout, takes the shared writer lock, requires a clean MemFS repository,
     and commits only its two declared output paths.
