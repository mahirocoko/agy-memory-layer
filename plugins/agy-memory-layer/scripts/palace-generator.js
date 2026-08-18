#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const memoryRoot = process.env.MEMORY_ROOT || path.join(process.env.HOME, ".gemini", "memory");
const activeWorkspace = process.argv[2] || process.cwd();
const outputFile = process.argv[3] || "/tmp/agy-memory-palace.html";
const activeSlug = path.basename(activeWorkspace).toLowerCase().replace(/\s+/g, "-");

// Ensure dirs
fs.mkdirSync(path.join(memoryRoot, "global"), { recursive: true });
fs.mkdirSync(path.join(memoryRoot, "projects"), { recursive: true });

// Read global files
const humanFile = path.join(memoryRoot, "global", "human.md");
const personaFile = path.join(memoryRoot, "global", "persona.md");

const humanMd = fs.existsSync(humanFile) ? fs.readFileSync(humanFile, "utf-8") : "";
const personaMd = fs.existsSync(personaFile) ? fs.readFileSync(personaFile, "utf-8") : "";

// Read git commits
let gitCommits = [];
try {
  const { execSync } = require("child_process");
  if (fs.existsSync(path.join(memoryRoot, ".git"))) {
    const logOut = execSync('git log -n 15 --pretty=format:\'{"hash":"%h","date":"%ad","msg":"%s"}\' --date=short', {
      cwd: memoryRoot,
      encoding: "utf-8"
    });
    gitCommits = logOut
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));
  }
} catch (e) {
  gitCommits = [];
}

// Read projects
const projectsDir = path.join(memoryRoot, "projects");
const projects = [];

if (fs.existsSync(projectsDir)) {
  const dirs = fs.readdirSync(projectsDir);
  for (const dir of dirs) {
    const fullPath = path.join(projectsDir, dir);
    if (fs.statSync(fullPath).isDirectory() && !dir.startsWith(".")) {
      const projFile = path.join(fullPath, "project.md");
      const rulesFile = path.join(fullPath, "rules.md");
      const learningsDir = path.join(fullPath, "learnings");

      const projContent = fs.existsSync(projFile) ? fs.readFileSync(projFile, "utf-8") : "";
      const rulesContent = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf-8") : "";

      let learnings = [];
      if (fs.existsSync(learningsDir)) {
        learnings = fs.readdirSync(learningsDir)
          .filter(f => f.endsWith(".md"))
          .map(f => ({
            filename: f,
            content: fs.readFileSync(path.join(learningsDir, f), "utf-8")
          }));
      }

      projects.push({
        slug: dir,
        isActive: dir === activeSlug,
        projectMd: projContent,
        rulesMd: rulesContent,
        learnings: learnings
      });
    }
  }
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Palace | Antigravity CLI</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --accent: #58a6ff;
      --accent-green: #3fb950;
      --accent-purple: #bc8cff;
      --accent-orange: #d29922;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.6;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .header h1 {
      color: var(--text-bright);
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(88, 166, 255, 0.3);
    }
    .badge-active {
      background: rgba(63, 185, 80, 0.15);
      color: var(--accent-green);
      border-color: rgba(63, 185, 80, 0.3);
    }
    .layout {
      display: grid;
      grid-template-columns: 280px 1fr 340px;
      gap: 20px;
    }
    @media (max-width: 1024px) {
      .layout { grid-template-columns: 1fr; }
    }
    .sidebar, .main, .timeline {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .nav-item {
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text);
      text-decoration: none;
      transition: background 0.15s;
    }
    .nav-item:hover, .nav-item.active {
      background: rgba(88, 166, 255, 0.1);
      color: var(--accent);
    }
    h2 {
      font-size: 16px;
      color: var(--text-bright);
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .content-block {
      margin-bottom: 20px;
    }
    .content-block h3 {
      color: var(--accent);
      font-size: 14px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    pre {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: #e6edf3;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .commit-item {
      padding: 10px;
      border-left: 2px solid var(--accent-purple);
      margin-bottom: 12px;
      background: rgba(188, 140, 255, 0.05);
      border-radius: 0 6px 6px 0;
    }
    .commit-hash {
      font-family: var(--font-mono);
      color: var(--accent-purple);
      font-size: 12px;
      font-weight: bold;
    }
    .commit-date {
      color: #8b949e;
      font-size: 11px;
      margin-left: 6px;
    }
    .commit-msg {
      font-size: 13px;
      margin-top: 4px;
      color: var(--text-bright);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🏛️ Memory Palace <span class="badge">Antigravity CLI</span></h1>
    <div>
      <span class="badge badge-active">Active: ${escapeHtml(activeSlug || "None")}</span>
      <span style="font-size: 12px; margin-left: 10px; color: #8b949e;">~/.gemini/memory</span>
    </div>
  </div>

  <div class="layout">
    <div class="sidebar">
      <h2>🧠 Memory Scope</h2>
      <div class="nav-item active" onclick="showTab('global', this)">🌐 Global Profile</div>
      <div style="margin-top: 14px; margin-bottom: 8px; font-size: 12px; color: #8b949e; text-transform: uppercase;">Projects</div>
      ${projects.map(p => `
        <div class="nav-item" onclick="showTab('proj-${p.slug}', this)">
          <span>📁 ${escapeHtml(p.slug)}</span>
          ${p.isActive ? '<span class="badge badge-active" style="font-size: 10px; padding: 2px 6px;">active</span>' : ''}
        </div>
      `).join('')}
    </div>

    <div class="main" id="contentArea">
      <div id="tab-global">
        <h2>🌐 Global Memory Blocks</h2>
        <div class="content-block">
          <h3>👤 User Profile (human.md)</h3>
          <pre>${escapeHtml(humanMd) || "(Empty - Run /remember to record preferences)"}</pre>
        </div>
        <div class="content-block">
          <h3>🤖 Agent Persona (persona.md)</h3>
          <pre>${escapeHtml(personaMd) || "(Default Pair-Programming Persona)"}</pre>
        </div>
      </div>

      ${projects.map(p => `
        <div id="tab-proj-${p.slug}" style="display: none;">
          <h2>📁 Project: ${escapeHtml(p.slug)}</h2>
          <div class="content-block">
            <h3>🏗️ Architecture & Context (project.md)</h3>
            <pre>${escapeHtml(p.projectMd) || "(No project.md configured yet)"}</pre>
          </div>
          <div class="content-block">
            <h3>📋 Project Rules (rules.md)</h3>
            <pre>${escapeHtml(p.rulesMd) || "(No rules.md configured yet)"}</pre>
          </div>
          ${p.learnings.length > 0 ? `
            <div class="content-block">
              <h3>📖 Learning Logs (${p.learnings.length})</h3>
              ${p.learnings.map(l => `
                <div style="margin-bottom: 10px;">
                  <strong style="font-size: 12px; color: var(--accent-orange);">${escapeHtml(l.filename)}</strong>
                  <pre style="margin-top: 4px;">${escapeHtml(l.content)}</pre>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>

    <div class="timeline">
      <h2>📜 Git Snapshot Timeline</h2>
      ${gitCommits.length > 0 ? gitCommits.map(c => `
        <div class="commit-item">
          <span class="commit-hash">${escapeHtml(c.hash)}</span>
          <span class="commit-date">${escapeHtml(c.date)}</span>
          <div class="commit-msg">${escapeHtml(c.msg)}</div>
        </div>
      `).join('') : '<div style="color: #8b949e; font-size: 13px;">No commit snapshots yet.</div>'}
    </div>
  </div>

  <script>
    function showTab(id, el) {
      document.querySelectorAll("#contentArea > div").forEach(div => div.style.display = "none");
      document.querySelectorAll(".sidebar .nav-item").forEach(item => item.classList.remove("active"));
      const target = document.getElementById("tab-" + id);
      if (target) target.style.display = "block";
      if (el) el.classList.add("active");
    }
  </script>
</body>
</html>`;

fs.writeFileSync(outputFile, html, "utf-8");
console.log("✓ Memory Palace generated at: " + outputFile);
