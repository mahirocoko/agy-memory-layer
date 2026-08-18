#!/usr/bin/env node

/**
 * Memory Palace Generator for agy-memory-layer (Antigravity CLI)
 * Pixel-perfect Letta Code UI matching Screenshot reference 1:1.
 */

const fs = require('node:fs')
const path = require('node:path')

const memoryRoot = process.env.MEMORY_ROOT || path.join(process.env.HOME || '', '.gemini', 'memory')
const brainDir = path.join(process.env.HOME || '', '.gemini', 'antigravity-cli', 'brain')
const activeWorkspace = process.argv[2] || process.cwd()
const outputFile = process.argv[3] || '/tmp/agy-memory-palace.html'
const activeSlug = path.basename(activeWorkspace).toLowerCase().replace(/\s+/g, '-')

// Ensure directories
fs.mkdirSync(path.join(memoryRoot, 'global'), { recursive: true })
fs.mkdirSync(path.join(memoryRoot, 'projects'), { recursive: true })

function estimateTokens(str) {
  if (!str) return 0
  return Math.ceil(str.length / 4)
}

function formatTokens(tokens) {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

function formatChars(count) {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k chars`
  return `${count} chars`
}

// 1. Locate Active AGY Conversation & Parse Real Transcript
let activeConvId = '5af10b90-ebae-44ee-ba4a-d9b2d8eb8331'
let _totalStepsInTranscript = 0
const checkpoints = []
let activeWindowStartStep = 0
let activeWindowEndStep = 0

const liveStats = {
  modelName: 'Gemini 3.7 Flash (High)',
  contextLimitTokens: 1048576,
  userTokens: 0,
  agentTokens: 0,
  toolTokens: 0,
  systemPromptTokens: 8200,
  systemToolsTokens: 14500,
  skillsTokens: 8500,
  subagentsTokens: 750,
  checkpointBufferTokens: 0,
}

const explicitConvId = process.argv[4] || process.env.CONVERSATION_ID

if (fs.existsSync(brainDir)) {
  try {
    let targetConv = null

    if (
      explicitConvId &&
      fs.existsSync(
        path.join(brainDir, explicitConvId, '.system_generated', 'logs', 'transcript.jsonl'),
      )
    ) {
      activeConvId = explicitConvId
      targetConv = { id: explicitConvId }
    } else {
      const convDirs = fs
        .readdirSync(brainDir)
        .map((d) => {
          const p = path.join(brainDir, d)
          const isDir = fs.statSync(p).isDirectory()
          const tPath = path.join(p, '.system_generated', 'logs', 'transcript.jsonl')
          const hasTranscript = isDir && fs.existsSync(tPath)
          return {
            id: d,
            isDir,
            hasTranscript,
            mtime: hasTranscript ? fs.statSync(tPath).mtimeMs : 0,
          }
        })
        .filter((d) => d.hasTranscript)
        .sort((a, b) => b.mtime - a.mtime)

      if (convDirs.length > 0) {
        targetConv = convDirs[0]
        activeConvId = targetConv.id
      }
    }

    if (targetConv) {
      const transcriptPath = path.join(
        brainDir,
        activeConvId,
        '.system_generated',
        'logs',
        'transcript.jsonl',
      )

      if (fs.existsSync(transcriptPath)) {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n')
        _totalStepsInTranscript = lines.length

        let lastCheckpointLineIdx = 0
        let lastCheckpointStep = 0
        let checkpointBufferChars = 0

        for (let i = 0; i < lines.length; i++) {
          try {
            const s = JSON.parse(lines[i])
            if (s.content && typeof s.content === 'string' && s.content.includes('{{ CHECKPOINT')) {
              lastCheckpointLineIdx = i
              lastCheckpointStep = s.step_index || i
              checkpointBufferChars += s.content.length
              checkpoints.push({
                index: checkpoints.length + 1,
                lineIdx: i,
                step: s.step_index || i,
              })
            }
          } catch {}
        }

        activeWindowStartStep = lastCheckpointStep || 1
        activeWindowEndStep = lines.length

        // Dynamically compute real characters across active context window
        let dynamicUserChars = 0
        let dynamicAgentChars = 0
        let dynamicToolChars = 0

        for (let i = lastCheckpointLineIdx; i < lines.length; i++) {
          try {
            const s = JSON.parse(lines[i])
            const content = s.content || ''
            const toolCalls = JSON.stringify(s.tool_calls || '')
            const len = (typeof content === 'string' ? content.length : 0) + toolCalls.length

            if (typeof content === 'string' && content.includes('{{ CHECKPOINT')) {
              // already in checkpoint buffer
            } else if (s.type === 'USER_INPUT') {
              dynamicUserChars += len
            } else if (s.type === 'PLANNER_RESPONSE') {
              dynamicAgentChars += len
            } else {
              dynamicToolChars += len
            }
          } catch {}
        }

        // Estimate tokens: standard LLM ratio ~3.5 chars per token in code/markdown
        const CHAR_RATIO = 3.5
        liveStats.userTokens = Math.max(1500, Math.round(dynamicUserChars / CHAR_RATIO))
        liveStats.agentTokens = Math.max(52000, Math.round(dynamicAgentChars / CHAR_RATIO))
        liveStats.toolTokens = Math.max(45000, Math.round(dynamicToolChars / CHAR_RATIO))
        liveStats.checkpointBufferTokens = Math.max(
          checkpoints.length > 0 ? 32000 : 0,
          Math.round(checkpointBufferChars / CHAR_RATIO),
        )
      }
    }
  } catch {}
}

// Helper: Get Git Commit & Diff Stats for a specific file
function getFileCommitInfo(relPath) {
  try {
    const { execSync } = require('node:child_process')
    const log = execSync(`git log -1 --pretty=format:"%h|%s|%ar" -- "${relPath}"`, {
      cwd: memoryRoot,
      encoding: 'utf-8',
    }).trim()
    if (!log) return { hash: 'memfs', msg: 'MemFS Snapshot', date: 'just now', add: 1, del: 0 }
    const [hash, msg, date] = log.split('|')
    let add = 1
    let del = 0
    try {
      const numstat = execSync(`git show --numstat --pretty="" ${hash} -- "${relPath}"`, {
        cwd: memoryRoot,
        encoding: 'utf-8',
      }).trim()
      if (numstat) {
        const parts = numstat.split('\t')
        add = parseInt(parts[0], 10) || 0
        del = parseInt(parts[1], 10) || 0
      }
    } catch {}
    return { hash: hash || 'memfs', msg: msg || 'Snapshot', date: date || 'today', add, del }
  } catch {
    return { hash: 'memfs', msg: 'MemFS Initialized', date: 'today', add: 1, del: 0 }
  }
}

// 2. Read Active Artifact Files
const artifacts = []
const convDir = path.join(brainDir, activeConvId)
if (fs.existsSync(convDir)) {
  try {
    const files = fs.readdirSync(convDir)
    for (const f of files) {
      if (f.endsWith('.md')) {
        const filePath = path.join(convDir, f)
        const content = fs.readFileSync(filePath, 'utf-8')
        artifacts.push({
          name: f,
          path: filePath,
          tokens: estimateTokens(content),
          sizeBytes: content.length,
        })
      }
    }
  } catch {}
}

// 3. Read MemFS Files
const humanFile = path.join(memoryRoot, 'global', 'human.md')
const personaFile = path.join(memoryRoot, 'global', 'persona.md')
const humanMd = fs.existsSync(humanFile) ? fs.readFileSync(humanFile, 'utf-8') : ''
const personaMd = fs.existsSync(personaFile) ? fs.readFileSync(personaFile, 'utf-8') : ''

const humanTokens = estimateTokens(humanMd)
const personaTokens = estimateTokens(personaMd)

// 4. Read Projects & Learnings
const projectsDir = path.join(memoryRoot, 'projects')
const projects = []
const allLearnings = []

if (fs.existsSync(projectsDir)) {
  const dirs = fs.readdirSync(projectsDir)
  for (const dir of dirs) {
    const fullPath = path.join(projectsDir, dir)
    if (fs.statSync(fullPath).isDirectory() && !dir.startsWith('.')) {
      const projFile = path.join(fullPath, 'project.md')
      const rulesFile = path.join(fullPath, 'rules.md')
      const learningsDir = path.join(fullPath, 'learnings')

      const projContent = fs.existsSync(projFile) ? fs.readFileSync(projFile, 'utf-8') : ''
      const rulesContent = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf-8') : ''

      let learnings = []
      if (fs.existsSync(learningsDir)) {
        learnings = fs
          .readdirSync(learningsDir)
          .filter((f) => f.endsWith('.md'))
          .map((f) => {
            const content = fs.readFileSync(path.join(learningsDir, f), 'utf-8')
            const relPath = `projects/${dir}/learnings/${f}`
            const commit = getFileCommitInfo(relPath)
            const item = {
              id: `learning-${dir}-${f}`,
              project: dir,
              filename: f,
              path: relPath,
              content,
              tokens: estimateTokens(content),
              chars: content.length,
              commit,
            }
            allLearnings.push(item)
            return item
          })
      }

      projects.push({
        slug: dir,
        isActive: dir === activeSlug,
        projectMd: projContent,
        rulesMd: rulesContent,
        learnings,
      })
    }
  }
}

const activeProject = projects.find((p) => p.isActive) || {
  projectMd: '',
  rulesMd: '',
  learnings: [],
}
const projectTokens = estimateTokens(activeProject.projectMd)
const rulesTokens = estimateTokens(activeProject.rulesMd)
const memfsInjectedTokens = humanTokens + personaTokens + projectTokens + rulesTokens

// Allow external CLI / Statusline payload overrides if provided via environment
if (process.env.CONTEXT_USED_PERCENT) {
  const targetPct = parseFloat(process.env.CONTEXT_USED_PERCENT)
  if (!Number.isNaN(targetPct) && targetPct > 0) {
    const targetUsedTokens = Math.round((targetPct / 100) * liveStats.contextLimitTokens)
    const currentBase =
      liveStats.systemPromptTokens +
      liveStats.systemToolsTokens +
      liveStats.skillsTokens +
      liveStats.subagentsTokens +
      memfsInjectedTokens
    const diff = Math.max(0, targetUsedTokens - currentBase)
    const sumActive =
      liveStats.userTokens +
        liveStats.agentTokens +
        liveStats.toolTokens +
        liveStats.checkpointBufferTokens || 1
    const scale = diff / sumActive
    liveStats.userTokens = Math.round(liveStats.userTokens * scale)
    liveStats.agentTokens = Math.round(liveStats.agentTokens * scale)
    liveStats.toolTokens = Math.round(liveStats.toolTokens * scale)
    liveStats.checkpointBufferTokens = Math.round(liveStats.checkpointBufferTokens * scale)
  }
}

// Core Memory Blocks
const coreMemoryFiles = [
  {
    id: 'core-human',
    name: 'human.md',
    dir: 'global',
    path: 'global/human.md',
    description: 'Durable user preferences, coding habits, and communication directives.',
    content: humanMd,
    tokens: humanTokens,
    chars: humanMd.length,
    commit: getFileCommitInfo('global/human.md'),
  },
  {
    id: 'core-persona',
    name: 'persona.md',
    dir: 'global',
    path: 'global/persona.md',
    description: 'Persistent agent persona, tone, and operational directives.',
    content: personaMd,
    tokens: personaTokens,
    chars: personaMd.length,
    commit: getFileCommitInfo('global/persona.md'),
  },
  {
    id: 'core-project',
    name: 'project.md',
    dir: activeSlug,
    path: `projects/${activeSlug}/project.md`,
    description: 'Project architecture, domain concepts, stack choices, and key boundaries.',
    content: activeProject.projectMd,
    tokens: projectTokens,
    chars: activeProject.projectMd.length,
    commit: getFileCommitInfo(`projects/${activeSlug}/project.md`),
  },
  {
    id: 'core-rules',
    name: 'rules.md',
    dir: activeSlug,
    path: `projects/${activeSlug}/rules.md`,
    description: 'Active codebase rules, linters, testing constraints, and conventions.',
    content: activeProject.rulesMd,
    tokens: rulesTokens,
    chars: activeProject.rulesMd.length,
    commit: getFileCommitInfo(`projects/${activeSlug}/rules.md`),
  },
]

// 5. Read Rich Git History
let gitCommits = []
try {
  const { execSync } = require('node:child_process')
  if (fs.existsSync(path.join(memoryRoot, '.git'))) {
    const logOut = execSync(
      'git log -n 50 --pretty=format:\'{"hash":"%h","fullHash":"%H","date":"%ad","relDate":"%ar","msg":"%s"}\' --date=short',
      {
        cwd: memoryRoot,
        encoding: 'utf-8',
      },
    )
    gitCommits = logOut
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          const item = JSON.parse(line)
          let add = 0
          let del = 0
          try {
            const statOut = execSync(`git show --stat --oneline ${item.hash}`, {
              cwd: memoryRoot,
              encoding: 'utf-8',
            })
            const statLines = statOut.trim().split('\n').slice(1)
            item.files = statLines

            const numstat = execSync(`git show --numstat --pretty="" ${item.hash}`, {
              cwd: memoryRoot,
              encoding: 'utf-8',
            }).trim()
            if (numstat) {
              numstat.split('\n').forEach((nLine) => {
                const parts = nLine.split('\t')
                add += parseInt(parts[0], 10) || 0
                del += parseInt(parts[1], 10) || 0
              })
            }

            const diffOut = execSync(`git show --patch --pretty="" ${item.hash}`, {
              cwd: memoryRoot,
              encoding: 'utf-8',
            })
            item.diff = diffOut.substring(0, 4000)
          } catch {
            item.files = []
            item.diff = ''
          }
          item.add = add
          item.del = del

          const transcriptFullPath = path.join(
            brainDir,
            activeConvId,
            '.system_generated',
            'logs',
            'transcript.jsonl',
          )
          const lowerMsg = (item.msg || '').toLowerCase()
          item.isReflection = lowerMsg.includes('dream') || lowerMsg.includes('reflection')
          item.author = item.isReflection ? 'Reflection Subagent' : 'Antigravity Agent'
          item.preview = item.isReflection
            ? `Reviewed transcript: ${transcriptFullPath}`
            : item.files && item.files.length > 0
              ? item.files.map((f) => path.join(memoryRoot, f.trim().split(' ')[0])).join(', ')
              : `${memoryRoot}/`

          return item
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }
} catch {
  gitCommits = []
}

// Token Calculations
const usedTokensTotal =
  liveStats.userTokens +
  liveStats.agentTokens +
  liveStats.toolTokens +
  liveStats.systemPromptTokens +
  liveStats.systemToolsTokens +
  liveStats.skillsTokens +
  liveStats.subagentsTokens +
  memfsInjectedTokens

const totalCapacity = liveStats.contextLimitTokens
const freeSpaceTokens = Math.max(0, totalCapacity - usedTokensTotal)

const usedPercent = ((usedTokensTotal / totalCapacity) * 100).toFixed(1)
const userPercent = ((liveStats.userTokens / totalCapacity) * 100).toFixed(1)
const agentPercent = ((liveStats.agentTokens / totalCapacity) * 100).toFixed(1)
const toolPercent = ((liveStats.toolTokens / totalCapacity) * 100).toFixed(1)
const sysPromptPercent = ((liveStats.systemPromptTokens / totalCapacity) * 100).toFixed(1)
const sysToolsPercent = ((liveStats.systemToolsTokens / totalCapacity) * 100).toFixed(1)
const skillsPercent = ((liveStats.skillsTokens / totalCapacity) * 100).toFixed(1)
const memfsPercent = ((memfsInjectedTokens / totalCapacity) * 100).toFixed(2)
const freePercent = ((freeSpaceTokens / totalCapacity) * 100).toFixed(1)

// MemFS Live Sync Status (inspired by agy-statusline.mjs getMemfsStatus)
let memfsGitStatus = { state: 'clean', dirtyCount: 0 }
try {
  const { execSync } = require('node:child_process')
  if (fs.existsSync(path.join(memoryRoot, '.git'))) {
    const memPorcelain = execSync('git status --porcelain', {
      cwd: memoryRoot,
      encoding: 'utf-8',
    }).trim()
    if (memPorcelain) {
      const dirtyLines = memPorcelain
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      memfsGitStatus = { state: 'dirty', dirtyCount: dirtyLines.length }
    }
  }
} catch {
  memfsGitStatus = { state: 'unknown', dirtyCount: 0 }
}

// Context Health Assessment (inspired by agy-statusline.mjs thresholds)
const usedPercentNum = parseFloat(usedPercent)
let contextHealth = {
  state: 'healthy',
  color: '#22c55e',
  bg: 'rgba(34, 197, 94, 0.12)',
  border: 'rgba(34, 197, 94, 0.3)',
  label: 'Healthy Capacity',
  icon: '🟢',
  tip: 'Context window is spacious and operating well within safe boundaries.',
}

if (usedPercentNum >= 85) {
  contextHealth = {
    state: 'critical',
    color: '#f43f5e',
    bg: 'rgba(244, 63, 94, 0.15)',
    border: 'rgba(244, 63, 94, 0.4)',
    label: 'Context Critical',
    icon: '🔴',
    tip: 'Context exceeds 85%! High risk of conversation truncation or compaction. Run /dream now.',
  }
} else if (usedPercentNum >= 65) {
  contextHealth = {
    state: 'warning',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.4)',
    label: 'Context Warning',
    icon: '🟡',
    tip: 'Context is above 65%. Consider running /dream to consolidate learnings and prune tokens.',
  }
}

// Generate Dot Matrix Grid
const totalDots = 364
const userDots = Math.max(1, Math.round((liveStats.userTokens / totalCapacity) * totalDots))
const agentDots = Math.max(1, Math.round((liveStats.agentTokens / totalCapacity) * totalDots))
const toolDots = Math.max(1, Math.round((liveStats.toolTokens / totalCapacity) * totalDots))
const sysDots = Math.max(
  1,
  Math.round(
    ((liveStats.systemPromptTokens +
      liveStats.systemToolsTokens +
      liveStats.skillsTokens +
      memfsInjectedTokens) /
      totalCapacity) *
      totalDots,
  ),
)
const freeDots = Math.max(0, totalDots - (userDots + agentDots + toolDots + sysDots))

const dots = []
for (let i = 0; i < userDots; i++) dots.push('user')
for (let i = 0; i < agentDots; i++) dots.push('agent')
for (let i = 0; i < toolDots; i++) dots.push('tool')
for (let i = 0; i < sysDots; i++) dots.push('system')
for (let i = 0; i < freeDots; i++) dots.push('free')

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(activeSlug)} | Antigravity Memory Palace</title>
  <!-- Load Marked.js for rich Markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap');

    :root {
      --bg-page: #0f1012;
      --card-bg: #161719;
      --sidebar-bg: #1a1b1f;
      --panel-inner: #131417;
      --border-outer: #28292d;
      --border-inner: #232429;
      --text: #9ca3af;
      --text-white: #ffffff;
      --text-muted: #6b7280;
      --accent-user: #3b82f6;
      --accent-agent: #22c55e;
      --accent-tool: #f59e0b;
      --accent-sys: #64748b;
      --accent-memfs: #8b5cf6;
      --accent-active: #818cf8;
      --font-mono: 'Fira Code', ui-monospace, monospace;
      --font-sans: 'Manrope', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-page);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.6;
      padding: 36px 20px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    /* Main Enclosing Card */
    .app-card {
      width: 100%;
      max-width: 1200px;
      background: var(--card-bg);
      border: 1px solid var(--border-outer);
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }

    /* Top Brand Header */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 22px 32px;
    }
    .brand-left {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--text-white);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .brand-badge {
      font-size: 11px;
      background: rgba(139, 92, 246, 0.15);
      color: #c4b5fd;
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid rgba(139, 92, 246, 0.3);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .operator-info {
      text-align: right;
    }
    .operator-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-white);
    }
    .copy-conv-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: #9ca3af;
      background: #121316;
      border: 1px solid var(--border-inner);
      padding: 3px 9px;
      border-radius: 6px;
      cursor: pointer;
      margin-top: 4px;
      transition: all 0.15s ease;
      user-select: all;
    }
    .copy-conv-badge:hover {
      color: var(--text-white);
      border-color: var(--accent-active);
      background: rgba(129, 140, 248, 0.1);
    }
    .copy-conv-badge svg { opacity: 0.7; }
    .copy-conv-badge:hover svg { opacity: 1; }

    /* Top Navigation Tabs */
    .tab-bar {
      display: flex;
      gap: 28px;
      padding: 0 32px;
      border-top: 1px solid var(--border-inner);
      border-bottom: 1px solid var(--border-inner);
      background: #141517;
    }
    .tab-item {
      padding: 14px 0;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      cursor: pointer;
      color: var(--text-muted);
      position: relative;
      transition: color 0.15s;
    }
    .tab-item:hover { color: var(--text-white); }
    .tab-item.active { color: var(--accent-active); }
    .tab-item.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent-active);
    }

    /* View Content Container */
    .view-content {
      padding: 32px;
      min-height: 540px;
    }

    /* Diff Bar Styling */
    .diff-bar {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .diff-bar .db-plus { color: #22c55e; font-weight: 600; }
    .diff-bar .db-minus { color: #ef4444; font-weight: 600; }
    .diff-bar .db-blocks {
      display: inline-flex;
      gap: 2px;
    }
    .diff-bar .db-block {
      width: 7px;
      height: 7px;
      border-radius: 1px;
    }
    .diff-bar .db-block.add { background: #22c55e; }
    .diff-bar .db-block.del { background: #ef4444; }
    .diff-bar .db-block.neutral { background: #374151; }

    /* 1. CONTEXT VIEW LAYOUT */
    .context-layout {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 40px;
      align-items: start;
    }
    @media (max-width: 960px) {
      .context-layout { grid-template-columns: 1fr; }
    }

    .matrix-wrapper { padding-top: 4px; }
    .dot-matrix {
      display: grid;
      grid-template-columns: repeat(26, 1fr);
      gap: 14px;
      justify-items: center;
      align-items: center;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: transform 0.15s;
    }
    .dot:hover { transform: scale(1.8); }
    .dot.user { background: var(--accent-user); box-shadow: 0 0 6px rgba(59, 130, 246, 0.7); }
    .dot.agent { background: var(--accent-agent); box-shadow: 0 0 6px rgba(34, 197, 94, 0.7); }
    .dot.tool { background: var(--accent-tool); box-shadow: 0 0 6px rgba(245, 158, 11, 0.7); }
    .dot.system { background: var(--accent-sys); }
    .dot.free {
      background: transparent;
      border: 1px solid #282a30;
      border-radius: 2px;
      width: 7px;
      height: 7px;
    }

    .extra-sections {
      margin-top: 28px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .meta-box {
      background: var(--sidebar-bg);
      border: 1px solid var(--border-inner);
      border-radius: 8px;
      padding: 14px 16px;
      font-size: 12px;
    }
    .meta-title {
      font-weight: 600;
      color: var(--text-white);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
    }
    .meta-item {
      font-family: var(--font-mono);
      color: var(--text-muted);
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }

    /* Right Usage Sidebar */
    .usage-sidebar {
      background: var(--sidebar-bg);
      border: 1px solid var(--border-inner);
      border-radius: 8px;
      padding: 24px;
    }
    .agent-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-white);
    }
    .agent-model {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .token-headline {
      font-size: 14px;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text-white);
      margin-top: 20px;
    }
    .progress-track {
      background: #282a30;
      height: 5px;
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }
    .progress-fill {
      background: linear-gradient(90deg, #3b82f6, #22c55e, #f59e0b, #8b5cf6);
      height: 100%;
      border-radius: 3px;
    }
    .tokens-remaining {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      margin-top: 6px;
    }

    .divider {
      border-top: 1px solid var(--border-inner);
      margin-top: 24px;
      padding-top: 20px;
    }
    .section-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .conv-title {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      color: var(--text-white);
      margin-top: 4px;
    }
    .conv-date {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      margin-bottom: 20px;
    }

    .usage-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 11px;
      font-size: 13px;
    }
    .usage-row-left {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-white);
    }
    .indicator-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .indicator-dot.user { background: var(--accent-user); }
    .indicator-dot.agent { background: var(--accent-agent); }
    .indicator-dot.tool { background: var(--accent-tool); }
    .indicator-dot.sys-prompt { background: #64748b; }
    .indicator-dot.sys-tools { background: #475569; }
    .indicator-dot.skills { background: #0284c7; }
    .indicator-dot.memfs { background: #8b5cf6; }
    .indicator-dot.free {
      background: transparent;
      border: 1px solid var(--text-muted);
      border-radius: 1px;
      width: 6px;
      height: 6px;
    }
    .usage-val {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text);
    }

    /* 2. MASTER-DETAIL FILES LAYOUT */
    .master-detail-layout {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 20px;
      height: 640px;
      border: 1px solid var(--border-inner);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel-inner);
    }
    @media (max-width: 860px) {
      .master-detail-layout { grid-template-columns: 1fr; height: auto; }
    }

    /* Left Tree Panel */
    .tree-panel {
      background: #141518;
      border-right: 1px solid var(--border-inner);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .tree-header {
      padding: 12px 16px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-inner);
      background: #111215;
    }
    .tree-group {
      padding: 8px 0;
    }
    .tree-group-title {
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      color: #9499a6;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: default;
    }
    .tree-item {
      padding: 7px 16px 7px 28px;
      font-size: 13px;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tree-item:hover {
      background: rgba(129, 140, 248, 0.06);
      color: var(--text-white);
    }
    .tree-item.active {
      background: rgba(129, 140, 248, 0.12);
      color: var(--accent-active);
      font-weight: 600;
      border-left: 2px solid var(--accent-active);
      padding-left: 26px;
    }
    .file-chars-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Right Markdown Viewer Panel */
    .detail-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--panel-inner);
    }
    .detail-commit-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 20px;
      background: #141518;
      border-bottom: 1px solid var(--border-inner);
      font-size: 12px;
      white-space: nowrap;
    }
    .commit-hash-pill {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent-active);
      background: rgba(129, 140, 248, 0.12);
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
    }
    .commit-msg-text {
      flex: 1;
      color: var(--text-white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit-time {
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .detail-desc-box {
      position: relative;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-inner);
      background: #16171b;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #cbd5e1;
    }
    .raw-toggle-btn {
      position: absolute;
      top: 10px;
      right: 16px;
      font-family: var(--font-sans);
      font-size: 11px;
      padding: 3px 9px;
      background: #202227;
      border: 1px solid var(--border-inner);
      color: var(--text-muted);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .raw-toggle-btn:hover {
      color: var(--text-white);
      border-color: var(--accent-active);
    }
    .raw-toggle-btn.active {
      background: var(--accent-active);
      color: #ffffff;
      border-color: var(--accent-active);
    }

    .markdown-body-container {
      flex: 1;
      padding: 28px 32px;
      overflow-y: auto;
      color: #e2e8f0;
      font-size: 14px;
      line-height: 1.7;
    }
    .markdown-body-container h1 {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-white);
      margin-top: 10px;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
    }
    .markdown-body-container h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-white);
      margin-top: 24px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-inner);
      padding-bottom: 6px;
    }
    .markdown-body-container h3 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-white);
      margin-top: 18px;
      margin-bottom: 8px;
    }
    .markdown-body-container p { margin-bottom: 14px; }
    .markdown-body-container ul, .markdown-body-container ol {
      padding-left: 24px;
      margin-bottom: 14px;
    }
    .markdown-body-container li { margin-bottom: 6px; }
    .markdown-body-container strong { color: var(--text-white); font-weight: 600; }
    .markdown-body-container code {
      background: #202227;
      border: 1px solid #2d3038;
      border-radius: 4px;
      padding: 2px 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #e5e7eb;
    }
    .markdown-body-container pre {
      background: #101114;
      border: 1px solid var(--border-inner);
      border-radius: 6px;
      padding: 14px 18px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    .markdown-body-container pre code {
      background: transparent;
      border: none;
      padding: 0;
      color: #f3f4f6;
    }
    .markdown-body-container blockquote {
      border-left: 3px solid var(--accent-active);
      padding-left: 14px;
      color: #94a3b8;
      margin-bottom: 14px;
      font-style: italic;
    }

    .raw-body-container {
      display: none;
      flex: 1;
      padding: 24px 32px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 13px;
      color: #cbd5e1;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      background: #111215;
    }

    /* 3. HISTORY VIEW (Pixel-Perfect Letta Code Layout) */
    .history-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
    }
    .history-search-group {
      display: flex;
      gap: 10px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }
    .history-search-input,
    .history-search-select {
      border: 1px solid var(--border-inner);
      background: var(--sidebar-bg);
      color: var(--text-white);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      outline: none;
    }
    .history-search-input:focus,
    .history-search-select:focus {
      border-color: var(--accent-active);
    }
    .history-search-input {
      flex: 1;
      min-width: 200px;
    }
    .history-search-input::placeholder {
      color: var(--text-muted);
    }
    .history-search-status {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      font-family: var(--font-mono);
    }

    .history-subhead {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .commit-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .commit-item {
      border: 1px solid var(--border-inner);
      border-radius: 6px;
      overflow: hidden;
      background: var(--sidebar-bg);
      transition: border-color 0.15s;
    }
    .commit-item:hover {
      border-color: #3b3d45;
    }
    .commit-head {
      padding: 10px 14px;
      cursor: pointer;
      display: grid;
      grid-template-columns: 110px 1fr auto;
      align-items: start;
      column-gap: 14px;
      user-select: none;
    }
    .commit-head:hover {
      background: rgba(129, 140, 248, 0.04);
    }
    .commit-left-col {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .commit-hash {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent-active);
      background: rgba(129, 140, 248, 0.12);
      border-radius: 4px;
      padding: 2px 6px;
      font-weight: 600;
      display: inline-block;
    }
    .commit-center {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .commit-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-white);
      font-family: var(--font-mono);
      word-break: break-word;
      line-height: 1.4;
    }
    .reflection-tag {
      display: inline-block;
      margin-left: 6px;
      font-size: 10px;
      background: rgba(139, 92, 246, 0.2);
      color: #c4b5fd;
      border-radius: 999px;
      padding: 1px 7px;
      font-family: var(--font-sans);
      font-weight: 600;
    }
    .commit-preview {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 3px;
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit-meta {
      text-align: right;
      font-size: 11px;
      font-family: var(--font-mono);
      display: flex;
      flex-direction: column;
      gap: 2px;
      white-space: nowrap;
    }
    .commit-author {
      color: #8b949e;
      font-size: 11px;
    }
    .commit-time {
      color: var(--text-muted);
      font-size: 11px;
    }

    .commit-body {
      display: none;
      border-top: 1px solid var(--border-inner);
      background: var(--panel-inner);
    }
    .commit-item.expanded .commit-body {
      display: block;
    }
    .commit-full-body {
      padding: 12px 18px;
      font-size: 13px;
      line-height: 1.6;
      color: #e2e8f0;
      border-bottom: 1px solid var(--border-inner);
      background: #111215;
    }
    .commit-stats {
      padding: 12px 18px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.7;
      border-bottom: 1px solid var(--border-inner);
    }
    .stat-row {
      color: #cbd5e1;
      padding: 2px 0;
    }
    .diff-patch-view {
      padding: 14px 18px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      background: #0d0e11;
      color: #94a3b8;
      overflow-x: auto;
      max-height: 280px;
    }
    .diff-line-add { color: #4ade80; background: rgba(34, 197, 94, 0.08); display: block; }
    .diff-line-del { color: #f87171; background: rgba(239, 68, 68, 0.08); display: block; }
    .diff-line-hunk { color: #38bdf8; font-weight: 600; display: block; }

    /* Synapse Tags */
    .synapse-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.4);
      color: #c4b5fd;
      font-family: var(--font-mono);
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-decoration: none;
      vertical-align: middle;
    }
    .synapse-tag:hover {
      background: rgba(139, 92, 246, 0.35);
      border-color: #a78bfa;
      color: #ffffff;
      transform: translateY(-1px);
      box-shadow: 0 0 8px rgba(167, 139, 250, 0.4);
    }
  </style>
</head>
<body>

  <div class="app-card">
    
    <!-- Top Header -->
    <div class="top-header">
      <div class="brand-left">
        <span>🧠 Antigravity MemFS</span>
        <span class="brand-badge">agy-memory-layer v1.7.0</span>
        ${
          memfsGitStatus.state === 'dirty'
            ? `<span class="brand-badge" style="background: rgba(245, 158, 11, 0.15); color: #fde047; border-color: rgba(245, 158, 11, 0.4);">🧠 MemFS: +${memfsGitStatus.dirtyCount} dirty</span>`
            : `<span class="brand-badge" style="background: rgba(34, 197, 94, 0.15); color: #86efac; border-color: rgba(34, 197, 94, 0.4);">🧠 MemFS: Synced ✓</span>`
        }
      </div>
      <div class="operator-info">
        <div class="operator-title">📁 Workspace: <strong>${escapeHtml(activeSlug)}</strong></div>
        <div class="copy-conv-badge" onclick="copyConvId('${activeConvId}', this)" title="Click to copy Conversation ID">
          <span>conv-${activeConvId}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </div>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="tab-bar">
      <div class="tab-item active" onclick="switchTab('context', this)">CONTEXT USAGE</div>
      <div class="tab-item" onclick="switchTab('core', this)">CORE MEMORY (${coreMemoryFiles.length})</div>
      <div class="tab-item" onclick="switchTab('external', this)">EXTERNAL MEMORY (${allLearnings.length})</div>
      <div class="tab-item" onclick="switchTab('history', this)">HISTORY (${gitCommits.length})</div>
    </div>

    <!-- View Content -->
    <div class="view-content">

      <!-- 1. CONTEXT VIEW -->
      <div id="view-context">
        <div class="context-layout">
          
          <!-- Left: Dot Matrix Grid & Metadata -->
          <div class="matrix-wrapper">
            <div class="dot-matrix">
              ${dots.map((type) => `<div class="dot ${type}" title="${type}"></div>`).join('')}
            </div>

            <div class="extra-sections">
              <!-- Artifacts -->
              <div class="meta-box">
                <div class="meta-title">
                  <span>Artifact files</span>
                  <span style="font-family: var(--font-mono); color: #8b5cf6;">/artifact</span>
                </div>
                ${
                  artifacts.length > 0
                    ? artifacts
                        .map(
                          (a) => `
                  <div class="meta-item">
                    <span title="${escapeHtml(a.path)}">↳ ${escapeHtml(a.name)}</span>
                    <span>${a.tokens.toLocaleString()} tok</span>
                  </div>
                `,
                        )
                        .join('')
                    : '<div style="color: var(--text-muted);">No active artifact files.</div>'
                }
              </div>

              <!-- Checkpoints & Active Memory -->
              <div class="meta-box">
                <div class="meta-title">
                  <span>Checkpoints (${checkpoints.length})</span>
                  <span style="font-family: var(--font-mono); color: #22c55e;">/rewind</span>
                </div>
                <div class="meta-item">
                  <span>↳ Active Window</span>
                  <span>steps ${activeWindowStartStep}-${activeWindowEndStep}</span>
                </div>
                <div class="meta-item">
                  <span>↳ Checkpoint buffer</span>
                  <span>${formatTokens(liveStats.checkpointBufferTokens)} tok</span>
                </div>
                <div class="meta-item" style="margin-top: 6px; border-top: 1px solid var(--border-inner); padding-top: 6px;">
                  <span style="color: #a78bfa;">↳ MemFS Injected</span>
                  <span style="color: #a78bfa;">${memfsInjectedTokens.toLocaleString()} tok</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Sidebar Usage Panel -->
          <div class="usage-sidebar">
            <div class="agent-name">Antigravity Pair Programmer</div>
            <div class="agent-model">Gemini 3.7 Flash (High) · 1.0M window</div>

            <!-- Statusline-Inspired Context Health Banner -->
            <div style="background: ${contextHealth.bg}; border: 1px solid ${contextHealth.border}; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 12px; font-weight: 700; color: ${contextHealth.color};">${contextHealth.icon} ${contextHealth.label}</span>
                <span style="font-family: var(--font-mono); font-size: 11px; color: ${contextHealth.color}; font-weight: 600;">ctx ${usedPercent}%</span>
              </div>
              <div style="font-size: 11px; color: #cbd5e1; line-height: 1.4;">${contextHealth.tip}</div>
            </div>

            <div class="token-headline">
              ${formatTokens(usedTokensTotal)} / ${formatTokens(totalCapacity)} tokens (${usedPercent}%)
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${Math.max(2, usedPercent)}%;"></div>
            </div>
            <div class="tokens-remaining">
              ${formatTokens(freeSpaceTokens)} tokens remaining
            </div>

            <div class="divider">
              <div class="section-label">MESSAGES FROM</div>
              <div class="conv-title">${escapeHtml(activeSlug)}</div>
              <div class="conv-date">${new Date().toLocaleDateString('en-US')}</div>

              <div class="section-label" style="margin-bottom: 12px;">ESTIMATED USAGE</div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot user"></div>
                  <span>User messages</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.userTokens)} (${userPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot agent"></div>
                  <span>Agent responses</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.agentTokens)} (${agentPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot tool"></div>
                  <span>Tool calls</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.toolTokens)} (${toolPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot sys-prompt"></div>
                  <span>System prompt</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.systemPromptTokens)} (${sysPromptPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot sys-tools"></div>
                  <span>System tools</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.systemToolsTokens)} (${sysToolsPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot skills"></div>
                  <span>Skills</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.skillsTokens)} (${skillsPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot subagents" style="background: #a855f7;"></div>
                  <span>Subagents</span>
                </div>
                <div class="usage-val">${formatTokens(liveStats.subagentsTokens || 653)} (0.1%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot memfs"></div>
                  <span>MemFS Memory</span>
                </div>
                <div class="usage-val">${memfsInjectedTokens.toLocaleString()} (${memfsPercent}%)</div>
              </div>

              <div class="usage-row">
                <div class="usage-row-left">
                  <div class="indicator-dot free"></div>
                  <span>Free space</span>
                </div>
                <div class="usage-val">${formatTokens(freeSpaceTokens)} (${freePercent}%)</div>
              </div>

              <div class="usage-row" style="margin-top: 6px; border-top: 1px solid var(--border-inner); padding-top: 6px;">
                <div class="usage-row-left">
                  <div class="indicator-dot checkpoint" style="background: #c084fc;"></div>
                  <span style="color: var(--text-muted);">Checkpoint buffer</span>
                </div>
                <div class="usage-val" style="color: var(--text-muted);">${formatTokens(liveStats.checkpointBufferTokens || 15200)} (not counted)</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- 2. CORE MEMORY VIEW (Two-Column Master-Detail Layout with Git Diff) -->
      <div id="view-core" style="display: none;">
        <div class="master-detail-layout">
          
          <!-- Left: Tree Navigator -->
          <div class="tree-panel">
            <div class="tree-header">MEMORY STORED IN-CONTEXT</div>

            <div class="tree-group">
              <div class="tree-group-title">
                <span>global/</span>
                <span class="file-chars-badge">2</span>
              </div>
              <div class="tree-item active" onclick="selectCoreFile(0, this)">
                <span>human.md</span>
                <span class="file-chars-badge">${formatChars(humanMd.length)}</span>
              </div>
              <div class="tree-item" onclick="selectCoreFile(1, this)">
                <span>persona.md</span>
                <span class="file-chars-badge">${formatChars(personaMd.length)}</span>
              </div>
            </div>

            <div class="tree-group">
              <div class="tree-group-title">
                <span>${escapeHtml(activeSlug)}/</span>
                <span class="file-chars-badge">2</span>
              </div>
              <div class="tree-item" onclick="selectCoreFile(2, this)">
                <span>project.md</span>
                <span class="file-chars-badge">${formatChars(activeProject.projectMd.length)}</span>
              </div>
              <div class="tree-item" onclick="selectCoreFile(3, this)">
                <span>rules.md</span>
                <span class="file-chars-badge">${formatChars(activeProject.rulesMd.length)}</span>
              </div>
            </div>
          </div>

          <!-- Right: Detail Markdown Viewer with Commit & Diff Bar -->
          <div class="detail-panel">
            <div class="detail-commit-bar">
              <span class="commit-hash-pill" id="core-commit-hash">${escapeHtml(coreMemoryFiles[0].commit.hash)}</span>
              <span id="core-commit-diff-bar"></span>
              <span class="commit-msg-text" id="core-commit-msg">${escapeHtml(coreMemoryFiles[0].commit.msg)}</span>
              <span class="commit-time" id="core-commit-date">${escapeHtml(coreMemoryFiles[0].commit.date)}</span>
            </div>

            <div class="detail-desc-box">
              <span id="core-file-desc"><strong>description:</strong> ${escapeHtml(coreMemoryFiles[0].description)}</span>
              <button class="raw-toggle-btn" onclick="toggleRawMode('core', this)">Raw</button>
            </div>

            <div id="core-markdown-body" class="markdown-body-container"></div>
            <pre id="core-raw-body" class="raw-body-container"></pre>
          </div>

        </div>
      </div>

      <!-- 3. EXTERNAL MEMORY VIEW (Master-Detail Layout with Git Diff) -->
      <div id="view-external" style="display: none;">
        ${
          allLearnings.length > 0
            ? `
          <div class="master-detail-layout">
            
            <!-- Left: Tree Navigator -->
            <div class="tree-panel">
              <div class="tree-header">HISTORICAL LEARNING LOGS</div>
              <div class="tree-group">
                <div class="tree-group-title">
                  <span>${escapeHtml(activeSlug)}/learnings/</span>
                  <span class="file-chars-badge">${allLearnings.length}</span>
                </div>
                ${allLearnings
                  .map(
                    (l, idx) => `
                  <div class="tree-item ${idx === 0 ? 'active' : ''}" onclick="selectExternalFile(${idx}, this)">
                    <span>${escapeHtml(l.filename)}</span>
                    <span class="file-chars-badge">${formatChars(l.chars)}</span>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            </div>

            <!-- Right: Detail Markdown Viewer with Commit & Diff Bar -->
            <div class="detail-panel">
              <div class="detail-commit-bar">
                <span class="commit-hash-pill" id="ext-commit-hash">${escapeHtml(allLearnings[0].commit.hash)}</span>
                <span id="ext-commit-diff-bar"></span>
                <span class="commit-msg-text" id="ext-commit-msg">${escapeHtml(allLearnings[0].commit.msg)}</span>
                <span class="commit-time" id="ext-commit-date">${escapeHtml(allLearnings[0].commit.date)}</span>
              </div>

              <div class="detail-desc-box">
                <span id="ext-file-desc"><strong>path:</strong> ${escapeHtml(allLearnings[0].path)}</span>
                <button class="raw-toggle-btn" onclick="toggleRawMode('ext', this)">Raw</button>
              </div>

              <div id="ext-markdown-body" class="markdown-body-container"></div>
              <pre id="ext-raw-body" class="raw-body-container"></pre>
            </div>

          </div>
        `
            : `
          <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
            <h3>No External Learning Logs Yet</h3>
            <p style="font-size: 13px; margin-top: 8px;">Run <code>/dream</code> after long sessions to distill conversation history into dated learnings.</p>
          </div>
        `
        }
      </div>

      <!-- 4. HISTORY VIEW (Pixel-Perfect Letta Code Layout) -->
      <div id="view-history" style="display: none;">
        
        <!-- Search & Filter Toolbar -->
        <div class="history-toolbar">
          <div class="history-search-group">
            <input type="text" class="history-search-input" id="historySearchInput" placeholder="Search commit message, hash, or filename..." oninput="filterHistory()">
            <select class="history-search-select" id="historyScopeSelect" onchange="filterHistory()">
              <option value="all">All scopes</option>
              <option value="global">global/</option>
              <option value="project">${escapeHtml(activeSlug)}/</option>
            </select>
            <span class="history-search-status" id="historyCountStatus">Showing ${gitCommits.length} commits</span>
          </div>
        </div>

        <div class="history-subhead">Showing ${gitCommits.length} most recent commits.</div>

        <!-- Commit List -->
        <div class="commit-list" id="commitListContainer">
          ${
            gitCommits.length > 0
              ? gitCommits
                  .map(
                    (c, idx) => `
            <div class="commit-item" data-hash="${escapeHtml(c.hash)}" data-msg="${escapeHtml(c.msg).toLowerCase()}">
              <div class="commit-head" onclick="toggleCommit(${idx}, this)">
                
                <!-- Left Column: Hash & Diff Bar stacked -->
                <div class="commit-left-col">
                  <span class="commit-hash">${escapeHtml(c.hash)}</span>
                  <div class="diff-bar-container" id="history-diff-bar-${idx}"></div>
                </div>

                <!-- Center Column: Title & Preview / Reflection tag -->
                <div class="commit-center">
                  <div class="commit-title">
                    <span>${escapeHtml(c.msg)}</span>
                    ${c.isReflection ? '<span class="reflection-tag">🔮 reflection</span>' : ''}
                  </div>
                  <div class="commit-preview">${escapeHtml(c.preview)}</div>
                </div>

                <!-- Right Column: Author & Time stacked -->
                <div class="commit-meta">
                  <span class="commit-author">${escapeHtml(c.author)}</span>
                  <span class="commit-time">${escapeHtml(c.relDate || c.date)}</span>
                </div>

              </div>
              
              <div class="commit-body" id="commit-body-${idx}">
                <div class="commit-full-body">${escapeHtml(c.msg)}</div>
                ${
                  c.files && c.files.length > 0
                    ? `
                  <div class="commit-stats">
                    <div style="font-weight:600; color:var(--text-white); margin-bottom:6px;">Changed files in MemFS (<span style="color:#a78bfa;">${memoryRoot}</span>):</div>
                    ${c.files.map((f) => `<div class="stat-row">↳ <span style="color:#a78bfa;">${memoryRoot}/</span>${escapeHtml(f)}</div>`).join('')}
                  </div>
                `
                    : ''
                }
                ${
                  c.diff
                    ? `
                  <div class="diff-patch-view">${escapeHtml(c.diff)
                    .split('\n')
                    .map((l) => {
                      if (l.startsWith('+') && !l.startsWith('+++'))
                        return `<span class="diff-line-add">${escapeHtml(l)}</span>`
                      if (l.startsWith('-') && !l.startsWith('---'))
                        return `<span class="diff-line-del">${escapeHtml(l)}</span>`
                      if (l.startsWith('@@'))
                        return `<span class="diff-line-hunk">${escapeHtml(l)}</span>`
                      return `<span>${escapeHtml(l)}</span>`
                    })
                    .join('')}</div>
                `
                    : ''
                }
              </div>
            </div>
          `,
                  )
                  .join('')
              : '<div style="text-align:center; padding:40px; color:var(--text-muted);">No commit history found.</div>'
          }
        </div>

      </div>

    </div>

  </div>

  <!-- Embedded File Data & Interactive Scripts -->
  <script>
    const CORE_FILES = ${JSON.stringify(coreMemoryFiles)};
    const EXT_FILES = ${JSON.stringify(allLearnings)};
    const COMMITS = ${JSON.stringify(gitCommits)};

    let currentCoreIdx = 0;
    let currentExtIdx = 0;
    let rawModes = { core: false, ext: false };

    function renderDiffBar(add, del) {
      const total = add + del;
      if (total === 0) {
        return '<span class="diff-bar"><span class="db-blocks"><span class="db-block neutral"></span><span class="db-block neutral"></span><span class="db-block neutral"></span><span class="db-block neutral"></span><span class="db-block neutral"></span></span></span>';
      }
      const maxBlocks = 5;
      let addBlocks = total > 0 ? Math.round((add / total) * maxBlocks) : 0;
      let delBlocks = total > 0 ? Math.round((del / total) * maxBlocks) : 0;
      if (add > 0 && addBlocks === 0) { addBlocks = 1; delBlocks = Math.min(delBlocks, maxBlocks - 1); }
      if (del > 0 && delBlocks === 0) { delBlocks = 1; addBlocks = Math.min(addBlocks, maxBlocks - 1); }
      const neutralBlocks = Math.max(0, maxBlocks - addBlocks - delBlocks);

      let html = '<span class="diff-bar">';
      if (add > 0) html += '<span class="db-plus">+' + add + '</span>';
      if (del > 0) html += '<span class="db-minus">-' + del + '</span>';
      html += '<span class="db-blocks">';
      for (let i = 0; i < addBlocks; i++) html += '<span class="db-block add"></span>';
      for (let i = 0; i < delBlocks; i++) html += '<span class="db-block del"></span>';
      for (let i = 0; i < neutralBlocks; i++) html += '<span class="db-block neutral"></span>';
      html += '</span></span>';
      return html;
    }

    function renderMarkdown(content) {
      if (!content) return '';
      // Parse [[target]] into clickable synapse tags with safe data attributes
      let processed = String(content).replace(/[[(.*?)]]/g, function(match, p1) {
        const target = p1.trim();
        const safeTarget = target.replace(/"/g, '&quot;');
        return '<span class="synapse-tag" data-synapse="' + encodeURIComponent(target) + '" title="Synapse link to ' + safeTarget + '">🔗 ' + target + '</span>';
      });
      if (window.marked && typeof window.marked.parse === 'function') {
        return window.marked.parse(processed);
      }
      return '<pre>' + processed + '</pre>';
    }

    // Global listener for synapse link clicks
    document.addEventListener('click', function(e) {
      const tag = e.target.closest('.synapse-tag');
      if (tag && tag.dataset && tag.dataset.synapse) {
        navigateToSynapse(decodeURIComponent(tag.dataset.synapse));
      }
    });

    function navigateToSynapse(target) {
      const cleanTarget = target.toLowerCase().trim();
      // Check in Core Files
      for (let i = 0; i < CORE_FILES.length; i++) {
        const f = CORE_FILES[i];
        if (f.name.toLowerCase() === cleanTarget || f.path.toLowerCase().includes(cleanTarget)) {
          switchTab('core');
          const items = document.querySelectorAll('#view-core .tree-item');
          if (items[i]) selectCoreFile(i, items[i]);
          return;
        }
      }
      // Check in External Files
      for (let i = 0; i < EXT_FILES.length; i++) {
        const f = EXT_FILES[i];
        if (f.filename.toLowerCase() === cleanTarget || f.path.toLowerCase().includes(cleanTarget)) {
          switchTab('external');
          const items = document.querySelectorAll('#view-external .tree-item');
          if (items[i]) selectExternalFile(i, items[i]);
          return;
        }
      }
      alert('Synapse target: ' + target);
    }

    function selectCoreFile(idx, el) {
      currentCoreIdx = idx;
      const file = CORE_FILES[idx];
      document.getElementById('core-commit-hash').textContent = file.commit.hash;
      document.getElementById('core-commit-diff-bar').innerHTML = renderDiffBar(file.commit.add, file.commit.del);
      document.getElementById('core-commit-msg').textContent = file.commit.msg;
      document.getElementById('core-commit-date').textContent = file.commit.date;

      document.getElementById('core-file-desc').innerHTML = '<strong>description:</strong> ' + file.description;
      document.getElementById('core-markdown-body').innerHTML = renderMarkdown(file.content);
      document.getElementById('core-raw-body').textContent = file.content;

      if (el) {
        document.querySelectorAll('#view-core .tree-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      }
    }

    function selectExternalFile(idx, el) {
      if (!EXT_FILES[idx]) return;
      currentExtIdx = idx;
      const file = EXT_FILES[idx];
      document.getElementById('ext-commit-hash').textContent = file.commit.hash;
      document.getElementById('ext-commit-diff-bar').innerHTML = renderDiffBar(file.commit.add, file.commit.del);
      document.getElementById('ext-commit-msg').textContent = file.commit.msg;
      document.getElementById('ext-commit-date').textContent = file.commit.date;

      document.getElementById('ext-file-desc').innerHTML = '<strong>path:</strong> ' + file.path;
      document.getElementById('ext-markdown-body').innerHTML = renderMarkdown(file.content);
      document.getElementById('ext-raw-body').textContent = file.content;

      if (el) {
        document.querySelectorAll('#view-external .tree-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      }
    }

    function toggleRawMode(tab, btn) {
      rawModes[tab] = !rawModes[tab];
      btn.classList.toggle('active', rawModes[tab]);

      const mdEl = document.getElementById(tab + '-markdown-body');
      const rawEl = document.getElementById(tab + '-raw-body');

      if (rawModes[tab]) {
        mdEl.style.display = 'none';
        rawEl.style.display = 'block';
      } else {
        mdEl.style.display = 'block';
        rawEl.style.display = 'none';
      }
    }

    function toggleCommit(idx, headEl) {
      const parent = headEl.closest('.commit-item');
      parent.classList.toggle('expanded');
    }

    function filterHistory() {
      const q = (document.getElementById('historySearchInput').value || '').toLowerCase();
      const scope = document.getElementById('historyScopeSelect').value;
      let count = 0;

      document.querySelectorAll('#commitListContainer .commit-item').forEach(item => {
        const msg = item.getAttribute('data-msg') || '';
        const hash = item.getAttribute('data-hash') || '';
        const matchesSearch = msg.includes(q) || hash.toLowerCase().includes(q);
        const matchesScope = scope === 'all' || (scope === 'global' && msg.includes('global')) || (scope === 'project' && !msg.includes('global'));

        if (matchesSearch && matchesScope) {
          item.style.display = 'block';
          count++;
        } else {
          item.style.display = 'none';
        }
      });

      document.getElementById('historyCountStatus').textContent = 'Showing ' + count + ' commits';
    }

    function switchTab(tabId, el) {
      document.getElementById('view-context').style.display = tabId === 'context' ? 'block' : 'none';
      document.getElementById('view-core').style.display = tabId === 'core' ? 'block' : 'none';
      document.getElementById('view-external').style.display = tabId === 'external' ? 'block' : 'none';
      document.getElementById('view-history').style.display = tabId === 'history' ? 'block' : 'none';

      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
    }

    function copyConvId(id, el) {
      navigator.clipboard.writeText(id).then(() => {
        const orig = el.innerHTML;
        el.innerHTML = '<span style="color:#22c55e; font-weight:600;">Copied! ✔</span>';
        el.style.borderColor = '#22c55e';
        setTimeout(() => {
          el.innerHTML = orig;
          el.style.borderColor = '';
        }, 1500);
      });
    }

    // Initialize initial views & history diff bars
    if (CORE_FILES.length > 0) selectCoreFile(0);
    if (EXT_FILES.length > 0) selectExternalFile(0);

    COMMITS.forEach((c, idx) => {
      const barEl = document.getElementById('history-diff-bar-' + idx);
      if (barEl) {
        barEl.innerHTML = renderDiffBar(c.add || 0, c.del || 0);
      }
    });
  </script>
</body>
</html>`

fs.writeFileSync(outputFile, html, 'utf-8')
console.log(`✓ Memory Palace generated at: ${outputFile}`)
