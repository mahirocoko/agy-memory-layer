---
name: creating-skills
description: Guide for creating effective skills. Use when creating a new skill or updating an existing one that extends the agent's capabilities with specialized knowledge, workflows, or tool integrations, whether a user asks for it or a reusable workflow is worth capturing.
---

# Creating Skills

This skill provides guidance for creating effective skills following the [Agent Skills specification](https://agentskills.io/specification).

## About Skills

Skills are modular, self-contained packages that extend the agent's capabilities by providing specialized knowledge, workflows, and tools. They transform a general-purpose coding agent into a specialized agent equipped with procedural knowledge that no model can fully possess out of the box.

### What Skills Provide

1. Specialized workflows — multi-step procedures for specific domains
2. Tool integrations — instructions for working with specific file formats, CLIs, or APIs
3. Domain expertise — project-specific knowledge, schemas, business logic
4. Bundled resources — scripts, references, and assets for complex and repetitive tasks

## Where Skills Live

Antigravity discovers skills from three filesystem locations (not inside the private `~/.gemini/memory/` store):

1. **Global User Skills (`~/.gemini/config/skills/<skill-name>/SKILL.md`)**:
   - Loaded across every project and workspace on the machine.
   - Default destination when creating a general-purpose or personal workflow skill.
2. **Project-Local Skills (`<project-root>/.agents/skills/<skill-name>/SKILL.md`)**:
   - Loaded only when working inside that repository.
   - Use for repository-specific workflows that should stay scoped to the project.
3. **Plugin Built-in Skills (`plugins/<plugin-name>/skills/<skill-name>/SKILL.md`)**:
   - Shipped inside an Antigravity plugin bundle such as `agy-memory-layer`.

*(Note: Short memory-only checklists that do not need a standalone skill directory or bundled scripts belong in maintained memory under `procedures/<name>.md` via `agent_memory_edit`.)*

## Core Principles

### Concise is Key

The context window is a shared resource alongside the system prompt, `[MemFS Active Memory]`, conversation history, other skills' metadata, and the user request. Challenge every paragraph: "Does the agent really need this explanation?" Prefer concise examples over verbose prose.

### Set Appropriate Degrees of Freedom

- **High freedom (text-based instructions)**: Multiple valid approaches; heuristics guide the choice.
- **Medium freedom (pseudocode or parameterized scripts)**: Preferred pattern exists with bounded variation.
- **Low freedom (exact scripts, strict parameters)**: Operations are fragile or error-prone; consistency is critical.

### Anatomy of a Skill

```text
processing-pdfs/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required: name, description)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable helpers (Node.js / Bash / Python)
    ├── references/       - Documentation loaded on demand
    └── assets/           - Output templates, icons, fonts
```

Do NOT include extraneous `README.md`, `INSTALLATION_GUIDE.md`, `QUICK_REFERENCE.md`, or `CHANGELOG.md` inside a skill directory.

### Progressive Disclosure Design Principle

1. **Metadata (`name` + `description`)** — always in `<available_skills>` (~100 words).
2. **`SKILL.md` body** — loaded when skill triggers (keep under 500 lines).
3. **Bundled resources** — loaded or executed on demand. Keep references one level deep under `references/`.

## Skill Creation Process

1. Understand the skill with concrete trigger examples.
2. Plan reusable skill contents (`scripts/`, `references/`, `assets/`).
3. Choose the target directory (`~/.gemini/config/skills/<name>/` or `.agents/skills/<name>/`).
4. Author `SKILL.md` in imperative/infinitive form:
   - `name`: lowercase letters, numbers, and hyphens only; matches directory name; max 64 chars.
   - `description`: third person explaining both what it does and when to trigger; max 1024 chars; no `<` or `>` angle brackets.
   - Consult [references/workflows.md](references/workflows.md) and [references/output-patterns.md](references/output-patterns.md) when helpful.
5. Validate plugin or skill layout (`agy plugin validate` when inside a plugin) and test with representative prompts.
