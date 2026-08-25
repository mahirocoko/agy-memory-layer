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
├── assets/                                  # Legacy pre-parity architecture illustrations (not current owners)
│   ├── architecture-flow.jpg
│   ├── subagents-architecture.jpg
│   └── semantic-recall-lifecycle.jpg
│
├── docs/                                    # Modular developer documentation family
│   ├── agy-host-e2e-2026-08-20.md           # Real interactive AGY host evidence and cleanup
│   ├── onboarding.md                        # Day 1 setup and verification
│   ├── project-overview.md                  # Architecture and subsystem overview
│   ├── letta-parity.md                      # Canonical Letta behavior/adaptation/status matrix
│   ├── releases/v1.12.1.md                  # Historical v1.12.1 evidence
│   ├── releases/v1.13.0.md                  # Prior scoped-health release evidence
│   ├── releases/v1.14.0.md                  # Current Evidence Controller release evidence
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
│   ├── agents/                              # Declarative Subagent Role Manifests (7 JSON specs)
│   │   ├── evidence_reviewer_agent.json
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
│   │   └── subagents/                       # System prompts for all 7 subagents
│   │
│   ├── rules/
│   │   └── AGENTS.md                        # In-Context autonomous memory directives
│   │
│   ├── skills/                              # 12 Slash command skill definitions
│   │   ├── evidence-controller/SKILL.md
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
│       ├── hook-inject-memory.sh            # Strict PreInvocation wrapper
│       ├── hook-inject-memory.ts            # Committed-HEAD projection owner
│       ├── hook-memory-status.sh             # Strict Stop wrapper
│       ├── hook-memory-status.ts             # Non-mutating Stop status owner
│       ├── active-learning.ts                 # Canonical committed working-hypothesis selector
│       ├── memory-repository.ts              # Containment, Git state, atomic write, targeted commit
│       ├── workspace-identity.ts             # Shared project scope and conversation workspace resolution
│       ├── dream-daemon.ts                  # Manual/optional-cron correction evidence archive
│       ├── recall-engine.ts                 # Subword N-Gram Vector & BM25 hybrid recall
│       ├── memory-search.ts                 # MemFS status and ranked text search
│       ├── init-project-memory.ts           # Codebase onboarding and memory seeding
│       ├── agent-launcher.ts                # Dynamic subagent resolver
│       ├── palace-generator.ts              # Memory Palace HTML generator
│       ├── switch-persona.ts                # Persona preset switcher
│       ├── letta-sync.ts                    # Letta payload extraction and MemFS import
│       ├── memory-approval.ts               # Optional proposal/approval workflow
│       ├── memory-compactor.ts              # Read-only Markdown maintenance analysis
│       ├── skill-synthesizer.ts             # Repeated-pattern skill drafts
│       ├── cross-project-synapse.ts         # Cross-project learning retrieval
│       ├── ts-inspector.ts                  # In-memory TypeScript language service
│       ├── worktree-manager.ts              # Isolated worktree utilities
│       ├── install.sh                       # Installer script
│       └── uninstall.sh                     # Uninstaller script
│
├── tools/
│   ├── memory-backup.ts                     # Complete verified backup/restore bundle
│   └── memory-health.ts                     # Deterministic active-memory health gate
│
└── tests/                                   # Automated test harness
    ├── test-environment.ts                  # Disposable HOME/MemFS fixture
    ├── run-test-suite.ts                    # Integration scenario runner and report generator
    ├── test-memory-backup.ts                # Backup integrity and path-containment tests
    └── unit-coverage.test.ts                # Focused engine unit cases
```
