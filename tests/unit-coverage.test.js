const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { describe, it } = require("node:test");
const assert = require("node:assert");

const ROOT_DIR = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT_DIR, "plugins", "agy-memory-layer");
const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");
const MEMORY_ROOT = path.join(process.env.HOME || "", ".gemini", "memory");

const { initProjectMemory, scanCodebase } = require(path.join(SCRIPTS_DIR, "init-project-memory.js"));
const { searchMemory } = require(path.join(SCRIPTS_DIR, "memory-search.js"));
const { exportMemoryBundle, verifyMemoryBundle, importMemoryBundle, runCli } = require(path.join(ROOT_DIR, "tools", "memory-backup.ts"));

describe("Unit Coverage Extensions", () => {
  it("tests init-project-memory with Rust, Go, Python, and Docker manifests", () => {
    const tempDir = "/tmp/test-multi-stack-project";
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "Cargo.toml"), '[package]\nname = "rust-app"');
    fs.writeFileSync(path.join(tempDir, "go.mod"), "module mygoapp\ngo 1.22");
    fs.writeFileSync(path.join(tempDir, "pyproject.toml"), '[project]\nname = "py-app"');
    fs.writeFileSync(path.join(tempDir, "wrangler.jsonc"), '{"name": "worker"}');
    fs.writeFileSync(path.join(tempDir, "docker-compose.yml"), 'version: "3"');
    fs.writeFileSync(path.join(tempDir, "src", "main.rs"), "fn main() {}");
    fs.writeFileSync(path.join(tempDir, "main.go"), "package main");
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Multi Stack App");

    const scanned = scanCodebase(tempDir);
    assert.strictEqual(scanned.languages.has("Rust"), true);
    assert.strictEqual(scanned.languages.has("Go"), true);
    assert.strictEqual(scanned.languages.has("Python"), true);
    assert.strictEqual(scanned.frameworks.has("Cloudflare Workers"), true);
    assert.strictEqual(scanned.frameworks.has("Docker"), true);

    const res1 = initProjectMemory(tempDir, { force: true });
    assert.strictEqual(res1.status, "INITIALIZED");

    // Test ALREADY_INITIALIZED branch
    const res2 = initProjectMemory(tempDir, { force: false });
    assert.strictEqual(res2.status, "ALREADY_INITIALIZED");

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(path.join(MEMORY_ROOT, "projects", "test-multi-stack-project"), { recursive: true, force: true });
  });

  it("tests memory-search error and edge cases", () => {
    assert.throws(() => searchMemory(""), /Search query must not be empty/);
    const nonExistent = searchMemory("supercalifragilistic_nonexistent_term_xyz_12345");
    assert.strictEqual(nonExistent.length, 0);
  });

  it("tests memory-backup CLI runner functions directly", () => {
    // Test help command
    let helpOutput = "";
    const origLog = console.log;
    console.log = (msg) => { helpOutput += msg + "\n"; };
    try {
      runCli(["help"]);
    } finally {
      console.log = origLog;
    }
    assert.strictEqual(helpOutput.includes("MemFS Backup & Restore Utility"), true);

    // Test export command CLI
    const tempBundle = "/tmp/test-cli-bundle.json";
    runCli(["export", "-o", tempBundle, "--json"]);
    assert.strictEqual(fs.existsSync(tempBundle), true);

    // Test verify command CLI
    runCli(["verify", "-i", tempBundle, "--json"]);

    // Test import command CLI (dry run)
    runCli(["import", "-i", tempBundle, "--dry-run", "--json"]);

    fs.unlinkSync(tempBundle);
  });

  it("tests switch-persona script functionality and presets", () => {
    const { PERSONA_PRESETS, getActivePersona, switchPersona } = require(path.join(SCRIPTS_DIR, "switch-persona.js"));
    
    assert.strictEqual(typeof PERSONA_PRESETS.memo, "object");
    assert.strictEqual(typeof PERSONA_PRESETS.linus, "object");
    assert.strictEqual(typeof PERSONA_PRESETS.tutor, "object");
    assert.strictEqual(typeof PERSONA_PRESETS.architect, "object");

    // Test switching persona
    switchPersona("linus");
    let current = getActivePersona();
    assert.strictEqual(current.id, "linus");

    switchPersona("memo");
    current = getActivePersona();
    assert.strictEqual(current.id, "memo");
  });

  it("tests hook-inject-memory budget notice calculation", () => {
    const hookScript = path.join(SCRIPTS_DIR, "hook-inject-memory.sh");
    const res = spawnSync("bash", [hookScript], {
      input: JSON.stringify({ workspacePaths: [ROOT_DIR] }),
      encoding: "utf-8"
    });
    assert.strictEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(Array.isArray(parsed.injectSteps), true);
    assert.strictEqual(parsed.injectSteps.length > 0, true);
    assert.strictEqual(parsed.injectSteps[0].ephemeralMessage.includes("MemFS Active Memory"), true);
  });

  it("tests recall-engine search, vector math, and hybrid modes", async () => {
    const { 
      tokenize, 
      cosineSimilarity, 
      buildTermFrequencyVector, 
      getConversationList, 
      searchRecall 
    } = require(path.join(SCRIPTS_DIR, "recall-engine.js"));
    
    // Test vectorization & cosine similarity
    const vecA = buildTermFrequencyVector(tokenize("database migrations schema sqlite"));
    const vecB = buildTermFrequencyVector(tokenize("sqlite database schema migration tool"));
    const vecC = buildTermFrequencyVector(tokenize("unrelated frontend css styling"));

    const simHigh = cosineSimilarity(vecA, vecB);
    const simLow = cosineSimilarity(vecA, vecC);

    assert.strictEqual(simHigh > 0.5, true);
    assert.strictEqual(simLow < simHigh, true);

    // Test search modes
    const convs = getConversationList(5);
    assert.strictEqual(Array.isArray(convs), true);

    const hybridMatches = await searchRecall("palace", { mode: "hybrid", limit: 3 });
    assert.strictEqual(Array.isArray(hybridMatches), true);

    const semanticMatches = await searchRecall("memory layer", { mode: "semantic", limit: 3 });
    assert.strictEqual(Array.isArray(semanticMatches), true);

    const keywordMatches = await searchRecall("git", { mode: "keyword", limit: 3 });
    assert.strictEqual(Array.isArray(keywordMatches), true);

    await assert.rejects(async () => {
      await searchRecall("");
    }, /Search query must not be empty/);
  });

  it("tests dream-daemon scanner, synthesis, and status reporter", () => {
    const { 
      scanPendingConversations, 
      synthesizeConversationLearning, 
      printStatus 
    } = require(path.join(SCRIPTS_DIR, "dream-daemon.js"));

    const pending = scanPendingConversations("learn-letta-code", { force: true, minSteps: 1, idleMinutes: 0 });
    assert.strictEqual(Array.isArray(pending), true);

    if (pending.length > 0) {
      const sample = pending[0];
      assert.strictEqual(typeof sample.id, "string");
      assert.strictEqual(typeof sample.shortId, "string");

      const doc = synthesizeConversationLearning(sample, "learn-letta-code");
      assert.strictEqual(typeof doc, "string");
      assert.strictEqual(doc.includes("Auto-Dream Learning"), true);
      assert.strictEqual(doc.includes(sample.id), true);
    }

    // Test step count triggers
    const { shouldFireStepCountTrigger, DEFAULT_STEP_COUNT } = require(path.join(SCRIPTS_DIR, "dream-daemon.js"));
    assert.strictEqual(DEFAULT_STEP_COUNT, 20);
    assert.strictEqual(shouldFireStepCountTrigger("mock-conv", 25, { stepCount: 20 }), true);
    assert.strictEqual(shouldFireStepCountTrigger("mock-conv", 5, { stepCount: 20 }), false);

    // Test print status function
    assert.doesNotThrow(() => {
      printStatus("learn-letta-code");
    });
  });

  it("tests agent-launcher subagent manifests and prompt resolution", () => {
    const { listSubagents, getSubagent } = require(path.join(SCRIPTS_DIR, "agent-launcher.js"));

    const subagents = listSubagents();
    assert.strictEqual(Array.isArray(subagents), true);
    assert.strictEqual(subagents.length, 6);

    const dreamSub = getSubagent("dream_agent");
    assert.strictEqual(typeof dreamSub, "object");
    assert.strictEqual(dreamSub.role, "Dream Reflection Subagent");
    assert.strictEqual(dreamSub.enableWriteTools, true);
    assert.strictEqual(typeof dreamSub.systemPrompt, "string");
    assert.strictEqual(dreamSub.systemPrompt.includes("Dream Reflection Subagent Prompt"), true);

    const memorySub = getSubagent("memory_agent");
    assert.strictEqual(typeof memorySub, "object");
    assert.strictEqual(memorySub.role, "MemFS Memory Specialist");
    assert.strictEqual(memorySub.enableWriteTools, true);

    const skillCreatorSub = getSubagent("skill_creator_agent");
    assert.strictEqual(typeof skillCreatorSub, "object");
    assert.strictEqual(skillCreatorSub.role, "Skill Creator Specialist");
    assert.strictEqual(skillCreatorSub.modelTier, "pro");

    const historySub = getSubagent("history_analyzer_agent");
    assert.strictEqual(typeof historySub, "object");
    assert.strictEqual(historySub.role, "Deep History Analyzer");

    const recallSub = getSubagent("recall_agent");
    assert.strictEqual(typeof recallSub, "object");
    assert.strictEqual(recallSub.role, "Episodic Recall Specialist");

    const onboardingSub = getSubagent("onboarding_agent");
    assert.strictEqual(typeof onboardingSub, "object");
    assert.strictEqual(onboardingSub.role, "Codebase Onboarding Specialist");
  });
});
