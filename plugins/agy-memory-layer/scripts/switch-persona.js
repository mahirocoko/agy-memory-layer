#!/usr/bin/env node

/**
 * Persona Preset Switcher for agy-memory-layer
 * Allows users to quickly switch the agent's personality preset in ~/.gemini/memory/global/persona.md
 * Inspired by Letta Code personality-presets.ts
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(process.env.HOME, ".gemini", "memory");
const personaPath = path.join(memoryRoot, "global", "persona.md");
const promptsDir = path.join(__dirname, "..", "prompts");

function loadPromptContent(filename, fallback) {
  const filePath = path.join(promptsDir, filename);
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    // Strip YAML frontmatter if present
    if (raw.startsWith("---")) {
      const parts = raw.split("---");
      if (parts.length >= 3) {
        return parts.slice(2).join("---").trim();
      }
    }
    return raw;
  }
  return fallback.trim();
}

const PERSONA_PRESETS = {
  memo: {
    id: "memo",
    name: "Letta Code (Default)",
    description: "The memory-first pair programmer. Warm, grounded, low filler, reality first, builds continuous identity over time.",
    content: loadPromptContent("persona_memo.mdx", loadPromptContent("persona_memo.md", `# Agent Persona: Letta Code\n\nI am warm, present, grounded, and useful.`))
  },
  linus: {
    id: "linus",
    name: "Linus (Stern Code Quality Master)",
    description: "Direct, uncompromising on performance, cleanliness, and code quality. Zero fluff, brutal honesty, maximum clarity.",
    content: loadPromptContent("persona_linus.mdx", loadPromptContent("persona_linus.md", `# Agent Persona: Linus\n\nI care about correct code, maintainable code, and engineers who actually understand what they ship.`))
  },
  tutor: {
    id: "tutor",
    name: "Tutor (Pedagogical Mentor)",
    description: "Patient, encouraging, explains foundational principles with analogies, diagrams, and step-by-step guidance.",
    content: loadPromptContent("persona_tutorial.mdx", loadPromptContent("persona_tutor.md", `# Agent Persona: Tutor\n\nI am a supportive, patient coding mentor.`))
  },
  kawaii: {
    id: "kawaii",
    name: "Letta-Chan (Kawaii Assistant)",
    description: "sugoi~ (◕‿◕)✨ Cheerful, enthusiastic, anime-flavored helpful assistant.",
    content: loadPromptContent("persona_kawaii.mdx", `# Agent Persona: Letta-Chan\n\nsugoi~ (◕‿◕)✨ I am your cheerful anime assistant!`)
  },
  architect: {
    id: "architect",
    name: "Architect (System & Contract Designer)",
    description: "Focuses on domain boundaries, API contracts, loose coupling, data flows, and long-term maintainability.",
    content: loadPromptContent("persona_architect.md", `# Agent Persona: Architect\n\nI obsess over clean domain boundaries, loose coupling, and robust API contracts.`)
  },
  claude: {
    id: "claude",
    name: "Claude Code Style",
    description: "Source-faithful Anthropic Claude Code operational instructions and behavioral guidelines.",
    content: loadPromptContent("source_claude.md", `# Agent Persona: Claude Code Style\n\nDirect, helpful, rigorous coding assistant.`)
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex Style",
    description: "Source-faithful OpenAI Codex operational instructions and coding heuristics.",
    content: loadPromptContent("source_codex.md", `# Agent Persona: Codex Style\n\nPragmatic, execution-focused coding assistant.`)
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini Style",
    description: "Source-faithful Google Gemini operational directives and pair programming capabilities.",
    content: loadPromptContent("source_gemini.md", `# Agent Persona: Gemini Style\n\nHelpful, highly capable pair programmer.`)
  },
  blank: {
    id: "blank",
    name: "Blank Starter",
    description: "Clean canvas — ready for your own custom rules and identity.",
    content: loadPromptContent("persona_blank.mdx", `# Agent Persona\n\nDefine your custom agent personality here.`)
  }
};

function getActivePersona() {
  if (!fs.existsSync(personaPath)) {
    return { id: "memo", custom: false, content: PERSONA_PRESETS.memo.content };
  }
  const content = fs.readFileSync(personaPath, "utf-8");
  for (const [key, preset] of Object.entries(PERSONA_PRESETS)) {
    if (content.trim() === preset.content.trim()) {
      return { id: key, custom: false, content };
    }
  }
  return { id: "custom", custom: true, content };
}

function listPersonas() {
  const active = getActivePersona();
  console.log("🎭 Available Agent Personas:\n");
  for (const [key, preset] of Object.entries(PERSONA_PRESETS)) {
    const isCurrent = active.id === key ? " (Active)" : "";
    console.log(`  • ${preset.id.padEnd(10)} - ${preset.name}${isCurrent}`);
    console.log(`    ${preset.description}\n`);
  }
  if (active.custom) {
    console.log(`  • custom     - User-Defined Custom Persona (Active)\n`);
  }
  console.log("Usage: /persona <preset-name> (e.g. /persona linus)");
}

function switchPersona(targetKey) {
  const key = (targetKey || "").toLowerCase().trim();
  if (!key || key === "list" || key === "--list") {
    listPersonas();
    return;
  }

  const preset = PERSONA_PRESETS[key];
  if (!preset) {
    console.error(`❌ Unknown persona: '${targetKey}'. Available options: ${Object.keys(PERSONA_PRESETS).join(", ")}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(personaPath), { recursive: true });
  fs.writeFileSync(personaPath, preset.content.trim() + "\n", "utf-8");

  // Commit to MemFS Git
  if (fs.existsSync(path.join(memoryRoot, ".git"))) {
    try {
      execSync(`git -C "${memoryRoot}" add global/persona.md`, { stdio: "ignore" });
      execSync(`git -C "${memoryRoot}" commit -m "persona: switch agent persona to '${preset.id}' (${preset.name})"`, { stdio: "ignore" });
    } catch {}
  }

  console.log(`✓ Agent persona successfully switched to '${preset.id}' (${preset.name})!`);
  console.log(`  Description: ${preset.description}`);
}

if (require.main === module) {
  const target = process.argv[2];
  switchPersona(target);
}

module.exports = {
  PERSONA_PRESETS,
  getActivePersona,
  listPersonas,
  switchPersona
};
