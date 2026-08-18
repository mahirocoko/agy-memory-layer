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
│   │   ├── imports.md                       # Node.js and CommonJS import rules
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
│   │   ├── persona/                         # 9 Personality presets (memo, linus, tutor, etc.)
│   │   ├── human/                           # User profile templates
│   │   └── subagents/                       # System prompts for all 6 subagents
│   │
│   ├── rules/
│   │   └── AGENTS.md                        # In-Context autonomous memory directives
│   │
│   ├── skills/                              # 10 Slash command skill definitions
│   │   ├── init/SKILL.md
│   │   ├── memory/SKILL.md
│   │   ├── recall/SKILL.md
│   │   ├── remember/SKILL.md
│   │   ├── persona/SKILL.md
│   │   ├── dream/SKILL.md
│   │   ├── doctor/SKILL.md
│   │   ├── palace/SKILL.md
│   │   ├── sync/SKILL.md
│   │   └── update/SKILL.md
│   │
│   └── scripts/                             # Runtime scripts and executables
│       ├── hook-inject-memory.sh            # PreInvocation hook (injects MemFS)
│       ├── hook-auto-commit.sh              # Stop hook (auto-commits & async daemon trigger)
│       ├── dream-daemon.js                  # 20-step auto-dream daemon & cron scheduler
│       ├── recall-engine.js                 # Subword N-Gram Vector & BM25 hybrid recall
│       ├── agent-launcher.js                # Dynamic subagent resolver
│       ├── palace-generator.js              # Memory Palace HTML generator
│       ├── switch-persona.js                # Persona preset switcher
│       ├── install.sh                       # Installer script
│       └── uninstall.sh                     # Uninstaller script
│
└── tests/                                   # Automated test harness
    ├── run-test-suite.js                    # Test harness runner
    └── unit-coverage.test.js                # Full unit test coverage suites
```
