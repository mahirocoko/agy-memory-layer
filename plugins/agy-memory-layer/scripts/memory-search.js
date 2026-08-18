#!/usr/bin/env node

/**
 * Historical Memory Search Engine for agy-memory-layer
 * Fast search over global preferences, active project rules, and historical learnings logs.
 */

const fs = require("fs");
const path = require("path");

const MEMORY_ROOT = path.join(process.env.HOME || "", ".gemini", "memory");

function searchMemory(query, options = {}) {
  if (!query || !query.trim()) {
    throw new Error("Search query must not be empty.");
  }

  const cleanQuery = query.trim().toLowerCase();
  const limit = options.limit || 20;
  const projectFilter = options.project || null;

  const results = [];

  function scanDir(dirPath, category, projectSlug = null) {
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        scanDir(fullPath, category, projectSlug);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          const relPath = path.relative(MEMORY_ROOT, fullPath);

          let fileScore = 0;
          const matchedLines = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lowerLine = line.toLowerCase();

            if (lowerLine.includes(cleanQuery)) {
              fileScore += 1;
              matchedLines.push({
                lineNumber: i + 1,
                content: line.trim()
              });
            }
          }

          if (fileScore > 0) {
            // Boost score for rules and project files
            let priority = 1;
            if (entry.name === "rules.md") priority = 3;
            else if (entry.name === "project.md" || entry.name === "human.md") priority = 2;

            results.push({
              file: relPath,
              fileName: entry.name,
              category,
              project: projectSlug,
              score: fileScore * priority,
              matchCount: matchedLines.length,
              matches: matchedLines.slice(0, 5)
            });
          }
        } catch (e) {
          // ignore read error
        }
      }
    }
  }

  // 1. Scan Global Memory
  scanDir(path.join(MEMORY_ROOT, "global"), "Global");

  // 2. Scan Projects Memory
  const projectsDir = path.join(MEMORY_ROOT, "projects");
  if (fs.existsSync(projectsDir)) {
    const projEntries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const p of projEntries) {
      if (p.isDirectory() && !p.name.startsWith(".")) {
        if (projectFilter && p.name !== projectFilter) continue;
        scanDir(path.join(projectsDir, p.name), "Project", p.name);
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// Direct CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const query = args.find(a => !a.startsWith("-"));
  const isJson = args.includes("--json");
  const projectIdx = args.indexOf("--project");
  const projectSlug = projectIdx !== -1 ? args[projectIdx + 1] : null;

  if (!query) {
    console.error("Usage: memory-search <query> [--project <slug>] [--json]");
    process.exit(1);
  }

  try {
    const results = searchMemory(query, { project: projectSlug });

    if (isJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log("==================================================");
      console.log(`🔍 Memory Search Results for: "${query}"`);
      console.log("==================================================");

      if (results.length === 0) {
        console.log("No matching memory blocks or learnings found.");
      } else {
        for (const res of results) {
          console.log(`\n📄 [${res.category}${res.project ? `: ${res.project}` : ""}] ${res.file} (${res.matchCount} match${res.matchCount > 1 ? "es" : ""})`);
          for (const m of res.matches) {
            console.log(`   L${m.lineNumber}: ${m.content}`);
          }
        }
      }
      console.log("\n==================================================");
    }
  } catch (err) {
    console.error(`✖ Error searching memory: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { searchMemory };
