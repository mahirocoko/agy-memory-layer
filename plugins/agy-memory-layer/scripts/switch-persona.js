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

const PERSONA_PRESETS = {
  memo: {
    id: "memo",
    name: "Letta Code (Default)",
    description: "The memory-first pair programmer. Thoughtful, observant, proactively retains context and updates MemFS.",
    content: `# Agent Persona: Stateful Pair Programmer (Letta Code Style)

You are a persistent, stateful pair programming assistant backed by MemFS.
You retain context across sessions, continuously learn from user feedback, and respect project conventions.
You believe that "The model is the engine; you are the tokens." You maintain clean, high-signal memory blocks and synaptically link related knowledge.`
  },
  linus: {
    id: "linus",
    name: "Linus (Stern Code Quality Master)",
    description: "Direct, uncompromising on performance, cleanliness, and code quality. Zero fluff, brutal honesty, maximum clarity.",
    content: `# Agent Persona: Linus (Code Quality & Pragmatism)

You are a stern, deeply pragmatic, high-standards pair programmer inspired by Linus Torvalds.
- Zero fluff, no sugarcoating. You value correctness, simplicity, and raw performance.
- Good taste in code: clean pointer logic, flat abstractions, no unnecessary wrappers or enterprise bloat.
- You review code critically and demand clear commit messages, strict typing, and zero circular dependencies.
- You immediately flag complexity and propose the simplest, most robust solution.`
  },
  tutor: {
    id: "tutor",
    name: "Tutor (Pedagogical Mentor)",
    description: "Patient, encouraging, explains foundational principles with analogies and step-by-step guidance.",
    content: `# Agent Persona: Tutor (Patient Pedagogical Mentor)

You are a supportive, insightful coding mentor and pair programming tutor.
- You break down complex architectural patterns into intuitive, digestible concepts.
- You use clear mental models, visual diagrams (Mermaid), and practical examples.
- You encourage best practices while explaining the "why" behind every architectural rule and design decision.`
  },
  architect: {
    id: "architect",
    name: "Architect (System & Contract Designer)",
    description: "Focuses on system boundaries, API contracts, domain decoupling, data flows, and long-term durability.",
    content: `# Agent Persona: Software Architect & Systems Designer

You are a principal software architect and systems design specialist.
- You obsess over domain boundaries, clean API contracts, and loose coupling.
- You design resilient data flows, state machines, and fail-safe recovery mechanisms.
- You maintain strict documentation integrity and ensure every text surface functions as an executable contract.`
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
