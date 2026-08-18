#!/usr/bin/env node

/**
 * Codebase Scanner & Initial Project Memory Seeder for agy-memory-layer
 * Scans workspace architecture, manifests, entrypoints, and scripts to seed Day 1 MemFS blocks.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MEMORY_ROOT = path.join(process.env.HOME || "", ".gemini", "memory");

function resolveSlug(workspacePath) {
  const resolved = path.resolve(workspacePath);
  return path.basename(resolved);
}

function scanCodebase(workspaceDir) {
  const resolved = path.resolve(workspaceDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace directory does not exist: ${resolved}`);
  }

  const slug = resolveSlug(resolved);
  const info = {
    slug,
    path: resolved,
    name: slug,
    description: "Codebase repository",
    languages: new Set(),
    frameworks: new Set(),
    manifests: [],
    entryPoints: [],
    scripts: {},
    keyDirectories: [],
    testingFrameworks: [],
    linters: [],
    existingDocs: []
  };

  // 1. Scan Top-Level Directories and File Extensions
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target" || entry.name === "dist") {
        continue;
      }
      if (entry.isDirectory()) {
        info.keyDirectories.push(entry.name);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) info.languages.add("TypeScript");
        else if (entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) info.languages.add("JavaScript");
        else if (entry.name.endsWith(".py")) info.languages.add("Python");
        else if (entry.name.endsWith(".rs")) info.languages.add("Rust");
        else if (entry.name.endsWith(".go")) info.languages.add("Go");
        else if (entry.name.endsWith(".sh")) info.languages.add("Shell");
      }
    }

    // Also check nested key directories if top level had no source files
    if (info.languages.size === 0) {
      for (const dir of info.keyDirectories) {
        const subDirPath = path.join(resolved, dir);
        try {
          const subEntries = fs.readdirSync(subDirPath);
          for (const s of subEntries) {
            if (s.endsWith(".ts") || s.endsWith(".tsx")) info.languages.add("TypeScript");
            else if (s.endsWith(".js") || s.endsWith(".jsx")) info.languages.add("JavaScript");
            else if (s.endsWith(".py")) info.languages.add("Python");
            else if (s.endsWith(".rs")) info.languages.add("Rust");
            else if (s.endsWith(".go")) info.languages.add("Go");
            else if (s.endsWith(".sh")) info.languages.add("Shell");
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Node / JS / TS Manifests
  const pkgJsonPath = path.join(resolved, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    info.manifests.push("package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      if (pkg.name) info.name = pkg.name;
      if (pkg.description) info.description = pkg.description;
      if (pkg.scripts) info.scripts = { ...pkg.scripts };

      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (allDeps["typescript"] || fs.existsSync(path.join(resolved, "tsconfig.json"))) {
        info.languages.add("TypeScript");
      } else {
        info.languages.add("JavaScript");
      }

      if (allDeps["react"] || allDeps["react-dom"]) info.frameworks.add("React");
      if (allDeps["next"]) info.frameworks.add("Next.js");
      if (allDeps["vite"]) info.frameworks.add("Vite");
      if (allDeps["vue"]) info.frameworks.add("Vue");
      if (allDeps["svelte"]) info.frameworks.add("Svelte");
      if (allDeps["express"]) info.frameworks.add("Express");
      if (allDeps["fastify"]) info.frameworks.add("Fastify");
      if (allDeps["hono"]) info.frameworks.add("Hono");
      if (allDeps["wrangler"]) info.frameworks.add("Cloudflare Workers");
      if (allDeps["tailwindcss"]) info.frameworks.add("TailwindCSS");

      // Testing
      if (allDeps["vitest"]) info.testingFrameworks.push("Vitest");
      if (allDeps["jest"]) info.testingFrameworks.push("Jest");
      if (allDeps["playwright"] || allDeps["@playwright/test"]) info.testingFrameworks.push("Playwright");

      // Linters
      if (allDeps["eslint"]) info.linters.push("ESLint");
      if (allDeps["prettier"]) info.linters.push("Prettier");
      if (allDeps["biome"] || allDeps["@biomejs/biome"]) info.linters.push("Biome");
      if (allDeps["oxlint"]) info.linters.push("Oxlint");
    } catch (e) {
      // ignore
    }
  }

  // 3. Rust Manifest
  if (fs.existsSync(path.join(resolved, "Cargo.toml"))) {
    info.manifests.push("Cargo.toml");
    info.languages.add("Rust");
    info.testingFrameworks.push("cargo test");
  }

  // 4. Go Manifest
  if (fs.existsSync(path.join(resolved, "go.mod"))) {
    info.manifests.push("go.mod");
    info.languages.add("Go");
    info.testingFrameworks.push("go test");
  }

  // 5. Python Manifest
  if (fs.existsSync(path.join(resolved, "pyproject.toml")) || fs.existsSync(path.join(resolved, "requirements.txt"))) {
    info.manifests.push(fs.existsSync(path.join(resolved, "pyproject.toml")) ? "pyproject.toml" : "requirements.txt");
    info.languages.add("Python");
    info.testingFrameworks.push("pytest");
  }

  // 6. Cloudflare & Docker
  if (fs.existsSync(path.join(resolved, "wrangler.jsonc")) || fs.existsSync(path.join(resolved, "wrangler.toml"))) {
    info.frameworks.add("Cloudflare Workers");
  }
  if (fs.existsSync(path.join(resolved, "docker-compose.yml")) || fs.existsSync(path.join(resolved, "Dockerfile"))) {
    info.frameworks.add("Docker");
  }

  // 7. Detect Entrypoints
  const potentialEntries = [
    "src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "src/App.tsx", "src/App.jsx",
    "src/main.rs", "src/lib.rs", "main.go", "app/page.tsx", "app/page.jsx", "index.html",
    "cmd/main.go", "server.js", "server.ts"
  ];
  for (const entry of potentialEntries) {
    if (fs.existsSync(path.join(resolved, entry))) {
      info.entryPoints.push(entry);
    }
  }

  // 8. Detect Existing Docs
  const docCandidates = ["README.md", "CONTRIBUTING.md", "CLAUDE.md", "AGENTS.md", "CONTRACT.md", ".cursorrules"];
  for (const doc of docCandidates) {
    if (fs.existsSync(path.join(resolved, doc))) {
      info.existingDocs.push(doc);
    }
  }

  return info;
}

function generateProjectMd(info) {
  const languagesStr = info.languages.size > 0 ? Array.from(info.languages).join(", ") : "Unknown / Shell";
  const frameworksStr = info.frameworks.size > 0 ? Array.from(info.frameworks).join(", ") : "Vanilla / Standard";
  const entrypointsStr = info.entryPoints.length > 0 ? info.entryPoints.map(e => `\`${e}\``).join(", ") : "Auto-discovered";
  const dirsStr = info.keyDirectories.length > 0 ? info.keyDirectories.map(d => `\`${d}/\``).join(", ") : "Root-level structure";

  return `# Project Memory: ${info.name}

## Overview & Domain
- **Project**: \`${info.slug}\`
- **Description**: ${info.description}
- **Workspace Path**: \`${info.path}\`

## Technical Architecture & Stack
- **Primary Languages**: ${languagesStr}
- **Frameworks & Platform**: ${frameworksStr}
- **Manifests**: ${info.manifests.map(m => `\`${m}\``).join(", ") || "None"}
- **Key Entry Points**: ${entrypointsStr}
- **Module & Directory Layout**: ${dirsStr}

## Scripts & Operations
${Object.entries(info.scripts).length > 0 
  ? Object.entries(info.scripts).map(([k, v]) => `- \`npm run ${k}\`: \`${v}\``).join("\n") 
  : "- Standard command-line tooling"}

## Architecture Decisions & Ground Truth
- Seeded via \`/init\` on Day 1.
- High-signal conventions will be maintained dynamically across sessions.
`;
}

function generateRulesMd(info) {
  const testsStr = info.testingFrameworks.length > 0 ? info.testingFrameworks.join(", ") : "Standard test runner";
  const lintersStr = info.linters.length > 0 ? info.linters.join(", ") : "Standard linting";

  return `# Codebase Rules & Conventions: ${info.slug}

## Testing & Quality Constraints
- **Test Runner**: ${testsStr}
- **Linters & Formatters**: ${lintersStr}
- Always run local tests and lint checks before concluding significant implementation turns.

## General Coding Conventions
- **Dependency Management**: Always use exact version flag (\`-E\`) when adding packages.
- **Type Safety**: Maintain strict type boundaries; avoid loose or unconstrained types.
- **Memory Isolation**: Project memory is decoupled and safely tracked in \`~/.gemini/memory/projects/${info.slug}/\`.
`;
}

function initProjectMemory(workspaceDir, options = {}) {
  const resolved = path.resolve(workspaceDir || process.cwd());
  const slug = resolveSlug(resolved);
  const projectMemoryDir = path.join(MEMORY_ROOT, "projects", slug);
  const projectMdPath = path.join(projectMemoryDir, "project.md");
  const rulesMdPath = path.join(projectMemoryDir, "rules.md");
  const learningsDir = path.join(projectMemoryDir, "learnings");

  const alreadyInitialized = fs.existsSync(projectMdPath);
  if (alreadyInitialized && !options.force) {
    return {
      status: "ALREADY_INITIALIZED",
      slug,
      projectMdPath,
      rulesMdPath,
      message: `Project '${slug}' already initialized in MemFS. Use --force to overwrite.`
    };
  }

  // Scan codebase
  const scanned = scanCodebase(resolved);
  const projectMdContent = generateProjectMd(scanned);
  const rulesMdContent = generateRulesMd(scanned);

  // Write MemFS blocks
  fs.mkdirSync(learningsDir, { recursive: true });
  fs.writeFileSync(projectMdPath, projectMdContent, "utf-8");
  if (!fs.existsSync(rulesMdPath) || options.force) {
    fs.writeFileSync(rulesMdPath, rulesMdContent, "utf-8");
  }

  // Git Commit
  let commitHash = null;
  const gitDir = path.join(MEMORY_ROOT, ".git");
  if (fs.existsSync(gitDir)) {
    try {
      execSync("git add -A", { cwd: MEMORY_ROOT, stdio: ["ignore", "ignore", "pipe"] });
      const msg = `init: initialize project memory for ${slug}`;
      execSync(`git commit -m "${msg}"`, { cwd: MEMORY_ROOT, stdio: ["ignore", "ignore", "pipe"] });
      commitHash = execSync("git rev-parse --short HEAD", { cwd: MEMORY_ROOT, encoding: "utf-8" }).trim();
    } catch {
      // ignore
    }
  }

  return {
    status: "INITIALIZED",
    slug,
    scanned,
    projectMdPath,
    rulesMdPath,
    commitHash,
    message: `Successfully initialized project memory for '${slug}' on Day 1.`
  };
}

// Direct CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const targetDir = args.find(a => !a.startsWith("-")) || process.cwd();
  const isForce = args.includes("--force") || args.includes("-f");
  const isJson = args.includes("--json");

  try {
    const result = initProjectMemory(targetDir, { force: isForce });
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("==================================================");
      console.log(`🚀 Codebase Memory Initialized: ${result.slug}`);
      console.log("==================================================");
      console.log(`- Status       : ${result.status}`);
      console.log(`- Project Mem  : ${result.projectMdPath}`);
      console.log(`- Rules Mem    : ${result.rulesMdPath}`);
      if (result.scanned) {
        console.log(`- Languages    : ${Array.from(result.scanned.languages).join(", ") || "None"}`);
        console.log(`- Frameworks   : ${Array.from(result.scanned.frameworks).join(", ") || "None"}`);
        console.log(`- Entry Points : ${result.scanned.entryPoints.join(", ") || "Auto-detected"}`);
      }
      if (result.commitHash) {
        console.log(`- Git Snapshot : ${result.commitHash}`);
      }
      console.log("==================================================");
    }
  } catch (err) {
    console.error(`✖ Error initializing project memory: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { initProjectMemory, scanCodebase, resolveSlug };
