#!/usr/bin/env node

/**
 * Subagent Helper & Manifest Resolver for agy-memory-layer
 * Loads subagent configurations from agents/*.json and resolves system prompts from prompts/subagents/*.md
 */

const fs = require("fs");
const path = require("path");

const AGENTS_DIR = path.resolve(__dirname, "..", "agents");

function listSubagents() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".json"));
  const subagents = [];

  for (const f of files) {
    try {
      const fullPath = path.join(AGENTS_DIR, f);
      const conf = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      
      let systemPrompt = "";
      if (conf.system_prompt_file) {
        const promptPath = path.resolve(AGENTS_DIR, conf.system_prompt_file);
        if (fs.existsSync(promptPath)) {
          systemPrompt = fs.readFileSync(promptPath, "utf-8");
        }
      }

      subagents.push({
        name: conf.name,
        role: conf.role,
        description: conf.description,
        modelTier: conf.model_tier || "inherit",
        enableWriteTools: Boolean(conf.enable_write_tools),
        enableMcpTools: Boolean(conf.enable_mcp_tools),
        enableSubagentTools: Boolean(conf.enable_subagent_tools),
        systemPrompt
      });
    } catch {}
  }

  return subagents;
}

function getSubagent(name) {
  const all = listSubagents();
  return all.find(a => a.name === name || a.role.toLowerCase().includes(name.toLowerCase())) || null;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || "list";

  if (cmd === "list") {
    console.log("\n🤖 Registered Antigravity Subagents in Plugin:\n");
    listSubagents().forEach((s, i) => {
      console.log(`[${i + 1}] 🏷️  Name: ${s.name} (${s.role})`);
      console.log(`    📝 ${s.description}`);
      console.log(`    ⚙️  Model: ${s.modelTier} | Write Tools: ${s.enableWriteTools}\n`);
    });
  } else if (cmd === "get") {
    const target = args[1];
    const sub = getSubagent(target);
    if (sub) {
      console.log(JSON.stringify(sub, null, 2));
    } else {
      console.error(`❌ Subagent "${target}" not found.`);
      process.exit(1);
    }
  }
}

module.exports = {
  listSubagents,
  getSubagent
};
