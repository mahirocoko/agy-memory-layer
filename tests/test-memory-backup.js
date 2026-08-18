#!/usr/bin/env node

/**
 * Unit Test Suite for tools/memory-backup.ts
 * Tests export, import, SHA-256 integrity checks, tamper detection, and project-specific conventions.
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const assert = require("assert");

const ROOT_DIR = path.resolve(__dirname, "..");
const TOOLS_DIR = path.join(ROOT_DIR, "tools");
const BACKUP_TOOL_TS = path.join(TOOLS_DIR, "memory-backup.ts");

const results = [];

function runTest(suite, name, testFn) {
  const startTime = Date.now();
  console.log(`▶ [${suite}] ${name}...`);
  try {
    const detail = testFn();
    const duration = Date.now() - startTime;
    results.push({
      suite,
      name,
      status: "PASSED",
      duration,
      detail: detail || "OK",
      error: null
    });
    console.log(`  ✔ PASSED (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - startTime;
    results.push({
      suite,
      name,
      status: "FAILED",
      duration,
      detail: null,
      error: err.message || String(err)
    });
    console.error(`  ✖ FAILED (${duration}ms): ${err.message}`);
  }
}

console.log("==================================================");
console.log("🧪 Running tools/memory-backup.ts Unit Tests");
console.log("==================================================");

// Setup temporary mock directory for testing
const TEST_SANDBOX = path.join(ROOT_DIR, ".test-sandbox-memory");
const TEST_RESTORE_DIR = path.join(ROOT_DIR, ".test-sandbox-restore");
const TEST_BUNDLE_PATH = path.join(ROOT_DIR, ".test-backup-bundle.json");

function cleanupSandbox() {
  if (fs.existsSync(TEST_SANDBOX)) fs.rmSync(TEST_SANDBOX, { recursive: true, force: true });
  if (fs.existsSync(TEST_RESTORE_DIR)) fs.rmSync(TEST_RESTORE_DIR, { recursive: true, force: true });
  if (fs.existsSync(TEST_BUNDLE_PATH)) fs.rmSync(TEST_BUNDLE_PATH, { force: true });
}

cleanupSandbox();

// -----------------------------------------------------------------------------
// Suite 1: TypeScript Compliance & Architecture Rules
// -----------------------------------------------------------------------------
runTest("TypeScript Rules", "Ensures tools/memory-backup.ts uses ONLY type alias and ZERO interface keywords", () => {
  const tsContent = fs.readFileSync(BACKUP_TOOL_TS, "utf-8");
  
  // Search for interface keyword as a declaration
  const interfaceRegex = /^\s*export\s+interface\s+|^\s*interface\s+/m;
  if (interfaceRegex.test(tsContent)) {
    throw new Error("Found 'interface' declaration in tools/memory-backup.ts! Project rule mandates 'type' alias ONLY.");
  }

  // Count type alias declarations
  const typeMatches = tsContent.match(/^\s*(export\s+)?type\s+\w+\s*=/gm) || [];
  if (typeMatches.length < 5) {
    throw new Error(`Expected at least 5 type alias definitions, found ${typeMatches.length}`);
  }

  return `Verified ${typeMatches.length} type alias definitions, 0 interface declarations. 100% compliant with project TypeScript rule.`;
});

// -----------------------------------------------------------------------------
// Suite 2: Export & Bundle Creation
// -----------------------------------------------------------------------------
runTest("Export Operations", "Exports full MemFS structure into single verifiable bundle with correct SHA256", () => {
  // Create sample mock MemFS tree
  fs.mkdirSync(path.join(TEST_SANDBOX, "global"), { recursive: true });
  fs.mkdirSync(path.join(TEST_SANDBOX, "projects", "proj-alpha", "learnings"), { recursive: true });
  fs.mkdirSync(path.join(TEST_SANDBOX, "projects", "proj-beta"), { recursive: true });

  fs.writeFileSync(path.join(TEST_SANDBOX, "global", "human.md"), "# Human Profile\nPrefers Thai language.");
  fs.writeFileSync(path.join(TEST_SANDBOX, "global", "persona.md"), "# Persona\nPair Programmer Agent.");
  fs.writeFileSync(path.join(TEST_SANDBOX, "projects", "proj-alpha", "project.md"), "# Alpha Architecture\nPostgreSQL & Bun");
  fs.writeFileSync(path.join(TEST_SANDBOX, "projects", "proj-alpha", "rules.md"), "# Alpha Rules\nNo console.log");
  fs.writeFileSync(path.join(TEST_SANDBOX, "projects", "proj-alpha", "learnings", "2026-08-18_db.md"), "# DB Learnings\nIndex optimization.");
  fs.writeFileSync(path.join(TEST_SANDBOX, "projects", "proj-beta", "project.md"), "# Beta Architecture\nNext.js 15");

  // Run CLI export
  const proc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "export",
    "--source", TEST_SANDBOX,
    "--output", TEST_BUNDLE_PATH,
    "--pretty"
  ], { encoding: "utf-8" });

  if (proc.status !== 0) {
    throw new Error(`Export failed: ${proc.stderr || proc.stdout}`);
  }

  assert.ok(fs.existsSync(TEST_BUNDLE_PATH), "Bundle file must exist");
  const bundle = JSON.parse(fs.readFileSync(TEST_BUNDLE_PATH, "utf-8"));

  assert.strictEqual(bundle.format, "agy-memfs-bundle/v1");
  assert.strictEqual(bundle.manifest.fileCount, 6);
  assert.ok(bundle.payloadChecksum.length === 64, "Payload checksum must be 64-char SHA256 hex");

  // Check file entries
  const relPaths = bundle.manifest.files.map(f => f.relativePath);
  assert.ok(relPaths.includes("global/human.md"));
  assert.ok(relPaths.includes("global/persona.md"));
  assert.ok(relPaths.includes("projects/proj-alpha/project.md"));
  assert.ok(relPaths.includes("projects/proj-alpha/learnings/2026-08-18_db.md"));
  assert.ok(relPaths.includes("projects/proj-beta/project.md"));

  return `Exported ${bundle.manifest.fileCount} files (${bundle.manifest.totalBytes} bytes) into single bundle. SHA-256: ${bundle.payloadChecksum.substring(0, 16)}...`;
});

// -----------------------------------------------------------------------------
// Suite 3: Integrity Verification & Tamper Detection
// -----------------------------------------------------------------------------
runTest("Integrity Verification", "Passes validation on genuine bundle and detects payload tampering", () => {
  // Test 1: Genuine bundle verification
  const verifyProc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "verify",
    "--input", TEST_BUNDLE_PATH
  ], { encoding: "utf-8" });

  if (verifyProc.status !== 0) {
    throw new Error(`Genuine bundle failed verification: ${verifyProc.stderr || verifyProc.stdout}`);
  }

  // Test 2: Tamper with file content inside bundle
  const tamperedBundle = JSON.parse(fs.readFileSync(TEST_BUNDLE_PATH, "utf-8"));
  tamperedBundle.manifest.files[0].content = "TAMPERED SECRET INJECTION";

  const tamperedPath = path.join(ROOT_DIR, ".test-tampered-bundle.json");
  fs.writeFileSync(tamperedPath, JSON.stringify(tamperedBundle));

  const failProc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "verify",
    "--input", tamperedPath
  ], { encoding: "utf-8" });

  fs.unlinkSync(tamperedPath);

  if (failProc.status === 0) {
    throw new Error("Tampered bundle unexpectedly passed verification!");
  }

  assert.ok(
    failProc.stdout.includes("TAMPERED") ||
    failProc.stdout.includes("mismatch") ||
    failProc.stdout.includes("VERIFICATION FAILED"),
    "Expected tampering failure message"
  );

  return "Verified 100% detection of unauthorized file content modification and payload checksum mismatch.";
});

// -----------------------------------------------------------------------------
// Suite 4: Import & Safe Restoration
// -----------------------------------------------------------------------------
runTest("Import & Restoration", "Restores memory blocks byte-for-byte and handles dry-run mode", () => {
  // Test Dry-Run first
  const dryProc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "import",
    "--input", TEST_BUNDLE_PATH,
    "--target", TEST_RESTORE_DIR,
    "--dry-run"
  ], { encoding: "utf-8" });

  if (dryProc.status !== 0) {
    throw new Error(`Dry run failed: ${dryProc.stderr || dryProc.stdout}`);
  }
  assert.ok(!fs.existsSync(TEST_RESTORE_DIR), "Dry run must NOT create target directory or files");

  // Actual Import
  const importProc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "import",
    "--input", TEST_BUNDLE_PATH,
    "--target", TEST_RESTORE_DIR,
    "--no-commit"
  ], { encoding: "utf-8" });

  if (importProc.status !== 0) {
    throw new Error(`Import failed: ${importProc.stderr || importProc.stdout}`);
  }

  // Byte-for-byte comparison of all original files
  const filesToVerify = [
    "global/human.md",
    "global/persona.md",
    "projects/proj-alpha/project.md",
    "projects/proj-alpha/rules.md",
    "projects/proj-alpha/learnings/2026-08-18_db.md",
    "projects/proj-beta/project.md"
  ];

  for (const rel of filesToVerify) {
    const orig = fs.readFileSync(path.join(TEST_SANDBOX, rel), "utf-8");
    const restored = fs.readFileSync(path.join(TEST_RESTORE_DIR, rel), "utf-8");
    assert.strictEqual(orig, restored, `Restored content mismatch for ${rel}`);
  }

  return "All 6 memory files restored byte-for-byte with exact directory hierarchy preservation.";
});

// -----------------------------------------------------------------------------
// Suite 5: Selective Project Filter Export
// -----------------------------------------------------------------------------
runTest("Project Filtering", "Exports only selected project memory blocks when --project filter is applied", () => {
  const filteredBundlePath = path.join(ROOT_DIR, ".test-filtered-bundle.json");

  const filterProc = spawnSync("node", [
    "--experimental-strip-types",
    BACKUP_TOOL_TS,
    "export",
    "--source", TEST_SANDBOX,
    "--output", filteredBundlePath,
    "--project", "proj-alpha"
  ], { encoding: "utf-8" });

  if (filterProc.status !== 0) {
    throw new Error(`Filtered export failed: ${filterProc.stderr || filterProc.stdout}`);
  }

  const bundle = JSON.parse(fs.readFileSync(filteredBundlePath, "utf-8"));
  fs.unlinkSync(filteredBundlePath);

  const paths = bundle.manifest.files.map(f => f.relativePath);
  assert.ok(paths.includes("global/human.md"), "Global profile must be included");
  assert.ok(paths.includes("projects/proj-alpha/project.md"), "proj-alpha must be included");
  assert.ok(!paths.includes("projects/proj-beta/project.md"), "proj-beta must NOT be included");

  return `Filtered bundle contains ${bundle.manifest.fileCount} files (proj-alpha included, proj-beta excluded).`;
});

// Clean up test sandbox
cleanupSandbox();

const total = results.length;
const passed = results.filter(r => r.status === "PASSED").length;
const failed = results.filter(r => r.status === "FAILED").length;

console.log("\n==================================================");
console.log(`📊 Result: ${passed}/${total} passed (${failed === 0 ? "ALL PASSED" : "FAILED"})`);
console.log("==================================================");

if (failed > 0) {
  process.exit(1);
}
