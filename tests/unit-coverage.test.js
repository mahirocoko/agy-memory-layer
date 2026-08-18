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
});
