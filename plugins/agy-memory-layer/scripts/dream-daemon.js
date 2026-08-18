#!/usr/bin/env node

/**
 * Auto-Dream Background Daemon for agy-memory-layer
 * Scans historical and recent conversations in ~/.gemini/antigravity-cli/brain/
 * Automatically synthesizes undreamed sessions into ~/.gemini/memory/projects/<slug>/learnings/
 * Inspired by Letta Code sleep-time reflection architecture & Step-Count triggers (DEFAULT_STEP_COUNT = 20)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DEFAULT_STEP_COUNT = 20;
const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(process.env.HOME, ".gemini", "memory");
const brainDir = path.join(process.env.HOME, ".gemini", "antigravity-cli", "brain");
const stateFile = path.join(memoryRoot, ".dream_state.json");

function getProjectSlug(workspaceDir = process.cwd()) {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel 2>/dev/null", { cwd: workspaceDir, encoding: "utf-8" }).trim();
    if (gitRoot) return path.basename(gitRoot);
  } catch {}
  return path.basename(workspaceDir);
}

function getDreamState() {
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    } catch {}
  }
  return {
    lastRun: null,
    stepCountThreshold: DEFAULT_STEP_COUNT,
    lastDreamedSteps: {} // { [convId]: stepIndex }
  };
}

function saveDreamState(state) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function shouldFireStepCountTrigger(convId, currentSteps, options = {}) {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT;
  const state = getDreamState();
  const lastStep = state.lastDreamedSteps[convId] || 0;
  const delta = currentSteps - lastStep;
  return delta >= threshold;
}

function getDreamedConversationIds(slug) {
  const dreamedIds = new Set();
  const learningsDir = path.join(memoryRoot, "projects", slug, "learnings");
  if (!fs.existsSync(learningsDir)) return dreamedIds;

  const files = fs.readdirSync(learningsDir).filter(f => f.endsWith(".md"));
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(learningsDir, f), "utf-8");
      // Check for conv ID patterns (e.g. conv-5af10b90 or full UUID)
      const matches = content.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi);
      if (matches) {
        matches.forEach(id => dreamedIds.add(id.toLowerCase()));
      }
      // Also check short IDs in filenames: YYYY-MM-DD_auto_dream_<shortId>.md
      const nameMatch = f.match(/auto_dream_([0-9a-f]{8})/i);
      if (nameMatch) {
        dreamedIds.add(nameMatch[1].toLowerCase());
      }
    } catch {}
  }

  return dreamedIds;
}

function scanPendingConversations(slug, options = {}) {
  if (!fs.existsSync(brainDir)) return [];
  const minSteps = options.minSteps || 8;
  const idleMinutes = options.idleMinutes || 15;
  const dreamedIds = getDreamedConversationIds(slug);

  const entries = fs.readdirSync(brainDir, { withFileTypes: true });
  const pending = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const convId = entry.name;
    const shortId = convId.slice(0, 8).toLowerCase();
    
    // Skip if already dreamed
    if (dreamedIds.has(convId.toLowerCase()) || dreamedIds.has(shortId)) {
      continue;
    }

    const logPath = path.join(brainDir, convId, ".system_generated", "logs", "transcript.jsonl");
    if (!fs.existsSync(logPath)) continue;

    try {
      const stat = fs.statSync(logPath);
      const ageMinutes = (Date.now() - stat.mtimeMs) / (1000 * 60);

      // Check step count
      const content = fs.readFileSync(logPath, "utf-8").trim();
      const lines = content.split("\n").filter(Boolean);
      if (lines.length < minSteps) continue;

      // Ensure session is idle (not actively being written right this second)
      if (ageMinutes < idleMinutes && !options.force) {
        continue;
      }

      // Extract opening prompt
      let firstPrompt = "Active coding session";
      try {
        const first = JSON.parse(lines[0]);
        if (first.content) firstPrompt = first.content.slice(0, 120).replace(/\n/g, " ");
      } catch {}

      pending.push({
        id: convId,
        shortId,
        mtime: stat.mtime,
        ageMinutes: Math.round(ageMinutes),
        steps: lines.length,
        firstPrompt,
        logPath
      });
    } catch {}
  }

  pending.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return pending;
}

function synthesizeConversationLearning(conv, slug) {
  const logPath = conv.logPath;
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  
  const userPrompts = [];
  const toolActions = [];
  const errorsResolved = [];

  for (const line of lines) {
    try {
      const step = JSON.parse(line);
      const content = step.content || "";

      if (step.type === "USER_INPUT") {
        const clean = content.replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, "$1").trim();
        if (clean.length > 0 && !clean.includes("CHECKPOINT")) {
          userPrompts.push(clean.slice(0, 200).replace(/\n/g, " "));
        }
      } else if (step.tool_calls && Array.isArray(step.tool_calls)) {
        step.tool_calls.forEach(tc => {
          if (tc.name) toolActions.push(tc.name);
        });
      }

      if (content.toLowerCase().includes("error") || content.toLowerCase().includes("fail")) {
        const errMatch = content.slice(0, 160).replace(/\n/g, " ");
        if (!errorsResolved.includes(errMatch)) {
          errorsResolved.push(errMatch);
        }
      }
    } catch {}
  }

  const today = new Date().toISOString().split("T")[0];
  const uniqueTools = Array.from(new Set(toolActions)).slice(0, 6);
  const samplePrompts = userPrompts.slice(0, 5);

  const markdown = `# Auto-Dream Learning: Session conv-${conv.shortId}

**Date**: ${today}  
**Conversation ID**: \`[conv-${conv.id}](conversation://${conv.id})\`  
**Workspace**: \`${slug}\`  
**Total Steps**: ${conv.steps}  
**Source**: Auto-Dream Background Daemon (Step-Count Trigger)  

---

## 1. Primary Objectives & Workflow
${samplePrompts.length > 0 ? samplePrompts.map((p, i) => `${i + 1}. ${p}`).join("\n") : "- General development & pair programming."}

---

## 2. Tools & Systems Touched
- Tools used: ${uniqueTools.length > 0 ? uniqueTools.map(t => `\`${t}\``).join(", ") : "Standard editor & search tools"}
- Session duration / Age: ${conv.ageMinutes} minutes ago

---

## 3. Durable Memory Lessons & Key Takeaways
- **Session Continuity**: Conversation \`${conv.id}\` completed successfully with ${conv.steps} execution turns.
- **Autonomous Recall**: Searchable via \`recall-engine.js search "${conv.shortId}"\`.
- **Knowledge Synapse**: [[projects/${slug}/project.md]] · [[projects/${slug}/rules.md]]
`;

  return markdown;
}

function runAutoDream(slug = getProjectSlug(), options = {}) {
  const pending = scanPendingConversations(slug, options);
  console.log(`\n🌙 Auto-Dream Scheduler for Workspace: "${slug}"`);
  console.log(`   Found ${pending.length} pending conversations to process.\n`);

  if (pending.length === 0) {
    console.log("✓ All conversations have already been dreamed and consolidated into MemFS.\n");
    return [];
  }

  const learningsDir = path.join(memoryRoot, "projects", slug, "learnings");
  if (!fs.existsSync(learningsDir)) {
    fs.mkdirSync(learningsDir, { recursive: true });
  }

  const processed = [];
  const today = new Date().toISOString().split("T")[0];
  const state = getDreamState();

  for (const conv of pending) {
    console.log(`  ⏳ Synthesizing conv-${conv.shortId} (${conv.steps} steps, ${conv.ageMinutes}m ago)...`);
    const doc = synthesizeConversationLearning(conv, slug);
    const targetFile = path.join(learningsDir, `${today}_auto_dream_${conv.shortId}.md`);

    fs.writeFileSync(targetFile, doc, "utf-8");
    state.lastDreamedSteps[conv.id] = conv.steps;
    processed.push({
      convId: conv.id,
      shortId: conv.shortId,
      file: targetFile
    });
    console.log(`     ↳ Saved to ${path.relative(memoryRoot, targetFile)}`);
  }

  state.lastRun = new Date().toISOString();
  saveDreamState(state);

  // Auto-commit snapshots to MemFS Git repository
  try {
    if (fs.existsSync(path.join(memoryRoot, ".git"))) {
      execSync("git add .", { cwd: memoryRoot, stdio: "ignore" });
      const status = execSync("git status --porcelain", { cwd: memoryRoot, encoding: "utf-8" }).trim();
      if (status) {
        execSync(`git commit -m "chore(dream): auto-dream consolidated ${processed.length} conversation sessions"`, {
          cwd: memoryRoot,
          stdio: "ignore"
        });
        console.log(`\n✓ Successfully auto-committed ${processed.length} dream logs into MemFS Git repository!`);
      }
    }
  } catch (err) {
    console.error("⚠️ Git commit warning:", err.message);
  }

  return processed;
}

function checkAndAutoDreamOnStepCount(slug = getProjectSlug(), options = {}) {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT;
  const pending = scanPendingConversations(slug, { force: true, minSteps: threshold, idleMinutes: 0 });
  const toProcess = pending.filter(p => shouldFireStepCountTrigger(p.id, p.steps, { stepCount: threshold }));

  if (toProcess.length > 0) {
    console.log(`🌙 Step-Count Trigger Fired: ${toProcess.length} conversations reached >= ${threshold} steps since last reflection.`);
    return runAutoDream(slug, { force: true, idleMinutes: 0 });
  }
  return [];
}

function printStatus(slug = getProjectSlug()) {
  const pending = scanPendingConversations(slug, { force: true, idleMinutes: 0 });
  const dreamed = getDreamedConversationIds(slug);
  const state = getDreamState();

  console.log(`\n🌙 Auto-Dream Status for Workspace: "${slug}"`);
  console.log(`   MemFS Directory: ${path.join(memoryRoot, "projects", slug)}`);
  console.log(`   Step-Count Trigger Threshold: ${state.stepCountThreshold} steps`);
  console.log(`   Last Auto-Dream Run: ${state.lastRun || "Never"}`);
  console.log(`   Total Dreamed Sessions: ${dreamed.size}`);
  console.log(`   Pending Undreamed Sessions: ${pending.length}\n`);

  if (pending.length > 0) {
    console.log("📋 Pending Sessions Queue:");
    pending.slice(0, 10).forEach((p, i) => {
      const willTrigger = shouldFireStepCountTrigger(p.id, p.steps);
      const triggerIcon = willTrigger ? "⚡ [Step Trigger]" : "⏳";
      console.log(`   [${i + 1}] conv-${p.shortId} (${p.steps} steps, ${p.ageMinutes}m ago) ${triggerIcon}`);
      console.log(`       "${p.firstPrompt}"`);
    });
    console.log("\nRun `node dream-daemon.js --run-now` to process them immediately.\n");
  } else {
    console.log("✓ All conversation sessions are up to date in MemFS.\n");
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || "--status";

  if (cmd === "--status" || cmd === "status") {
    printStatus();
  } else if (cmd === "--auto-check" || cmd === "auto-check") {
    checkAndAutoDreamOnStepCount();
  } else if (cmd === "--run-now" || cmd === "run" || cmd === "--run") {
    const force = args.includes("--force");
    runAutoDream(getProjectSlug(), { force, idleMinutes: 0 });
  } else if (cmd === "--install-cron") {
    try {
      const scriptPath = path.resolve(__filename);
      const cronCmd = `0 */2 * * * ${process.execPath} ${scriptPath} --run-now >/dev/null 2>&1`;
      let currentCrontab = "";
      try { currentCrontab = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" }); } catch {}
      if (currentCrontab.includes("dream-daemon.js")) {
        console.log("✓ Auto-Dream cron job is already installed.");
      } else {
        const newCrontab = currentCrontab.trim() + "\n" + cronCmd + "\n";
        execSync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`);
        console.log("✓ Auto-Dream cron job installed successfully (runs every 2 hours)!");
      }
    } catch (e) {
      console.error("❌ Failed to install cron:", e.message);
    }
  } else if (cmd === "--uninstall-cron") {
    try {
      let currentCrontab = "";
      try { currentCrontab = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" }); } catch {}
      const filtered = currentCrontab.split("\n").filter(l => !l.includes("dream-daemon.js")).join("\n");
      execSync(`echo "${filtered.replace(/"/g, '\\"')}" | crontab -`);
      console.log("✓ Auto-Dream cron job removed successfully.");
    } catch (e) {
      console.error("❌ Failed to remove cron:", e.message);
    }
  } else {
    printStatus();
  }
}

module.exports = {
  DEFAULT_STEP_COUNT,
  getDreamState,
  saveDreamState,
  shouldFireStepCountTrigger,
  checkAndAutoDreamOnStepCount,
  scanPendingConversations,
  synthesizeConversationLearning,
  runAutoDream,
  printStatus
};
