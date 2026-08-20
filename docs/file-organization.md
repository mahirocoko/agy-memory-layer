# File Organization & Directory Structure — `agy-memory-layer`

This document defines the structural boundaries, directory organization, and module responsibilities for `agy-memory-layer`.

---

## 📁 Repository Directory Layout

```text
learn-letta-code/
├── AGENTS.md                                # Root rules and engineering contract
├── README.md                                # Public quickstart and showcase
├── INSTALLATION_DETAILS.md                  # Thai lifecycle installation guide
├── CONTRACT.md                              # Formal architecture & schema specification
├── TEST_REPORT.md                           # Automated test execution report
├── package.json                             # Root Node.js manifest
│
├── assets/                                  # High-resolution visual architecture diagrams
│   ├── architecture-flow.jpg                # Full lifecycle and MemFS topology
│   ├── subagents-architecture.jpg           # 6-Subagent suite and launcher topology
│   └── semantic-recall-lifecycle.jpg        # Hybrid semantic recall & auto-dream flowchart
│
├── docs/                                    # Modular developer documentation family
│   ├── onboarding.md                        # Day 1 setup and verification
│   ├── project-overview.md                  # Architecture and subsystem overview
│   ├── development-commands.md              # CLI and daemon commands
│   ├── file-organization.md                 # Directory structure and module roles
│   ├── best-practices.md                    # Engineering principles and memory hygiene
│   ├── commit-guide.md                      # Git commit rules and review workflow
│   ├── code-style/
│   │   ├── typescript.md                    # Strict `type` alias conventions
│   │   ├── imports.md                       # Native ESM and Node.js import rules
│   │   └── formatting.md                    # Code formatting and markdown standards
│   └── patterns/
│       └── services-pattern.md              # Daemon, hook, and recall service patterns
│
├── plugins/agy-memory-layer/                # Core Antigravity Plugin bundle
│   ├── plugin.json                          # Plugin manifest and metadata
│   ├── hooks.json                           # Lifecycle hook registration (PreInvocation, Stop)
│   ├── agents/                              # First-Class Subagent Manifests (6 JSON specs)
│   │   ├── dream_agent.json
│   │   ├── recall_agent.json
│   │   ├── onboarding_agent.json
│   │   ├── memory_agent.json
│   │   ├── history_analyzer_agent.json
│   │   └── skill_creator_agent.json
│   │
│   ├── prompts/                             # Prompt Warehouse (System, Personas, Subagents)
│   │   ├── system/                          # Benchmarks & core system prompts
│   │   ├── persona/                         # 6 personality presets (memo, linus, tutor, architect, kawaii, blank)
│   │   ├── human/                           # User profile templates
│   │   └── subagents/                       # System prompts for all 6 subagents
│   │
│   ├── rules/
│   │   └── AGENTS.md                        # In-Context autonomous memory directives
│   │
│   ├── skills/                              # 11 Slash command skill definitions
│   │   ├── init/SKILL.md
│   │   ├── memory/SKILL.md
│   │   ├── recall/SKILL.md
│   │   ├── remember/SKILL.md
│   │   ├── persona/SKILL.md
│   │   ├── dream/SKILL.md
│   │   ├── doctor/SKILL.md
│   │   ├── palace/SKILL.md
│   │   ├── sync/SKILL.md
│   │   ├── sync-letta/SKILL.md
│   │   └── update/SKILL.md
│   │
│   └── scripts/                             # Runtime scripts and executables
│       ├── hook-inject-memory.sh            # PreInvocation hook (injects MemFS)
│       ├── hook-inject-memory.ts            # Preferred native ESM hook implementation
│       ├── hook-auto-commit.sh              # Stop hook (auto-commits & async daemon trigger)
│       ├── hook-auto-commit.ts              # Preferred native ESM hook implementation
│       ├── dream-daemon.ts                  # 20-step auto-dream daemon & cron scheduler
│       ├── recall-engine.ts                 # Subword N-Gram Vector & BM25 hybrid recall
│       ├── memory-search.ts                 # MemFS status and ranked text search
│       ├── init-project-memory.ts           # Codebase onboarding and memory seeding
│       ├── agent-launcher.ts                # Dynamic subagent resolver
│       ├── palace-generator.ts              # Memory Palace HTML generator
│       ├── switch-persona.ts                # Persona preset switcher
│       ├── letta-sync.ts                    # Letta payload extraction and MemFS import
│       ├── memory-approval.ts               # Optional proposal/approval workflow
│       ├── memory-compactor.ts              # Token compaction and learning archival
│       ├── skill-synthesizer.ts             # Repeated-pattern skill drafts
│       ├── cross-project-synapse.ts         # Cross-project learning retrieval
│       ├── ts-inspector.ts                  # In-memory TypeScript language service
│       ├── worktree-manager.ts              # Isolated worktree utilities
│       ├── install.sh                       # Installer script
│       └── uninstall.sh                     # Uninstaller script
│
└── tests/                                   # Automated test harness
    ├── test-environment.ts                  # Disposable HOME/MemFS fixture
    ├── run-test-suite.ts                    # Integration scenario runner and report generator
    ├── test-memory-backup.ts                # Backup integrity and path-containment tests
    └── unit-coverage.test.ts                # Focused engine unit cases
```
