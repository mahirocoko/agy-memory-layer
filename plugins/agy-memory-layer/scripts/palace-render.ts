#!/usr/bin/env node

/**
 * Offline Single-File Memory Palace HTML Renderer & Exporter.
 * Ported from mahiro-pi/lib/palace-render/abi2-page.ts (Letta Code visual grammar).
 * Zero external scripts, stylesheets, fonts, or HTTP servers; pure CSS tabs & toggles.
 * Strict TypeScript `type` aliases only.
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { inspectCommittedMemoryProjection } from './layered-memory.ts'
import {
  getMemoryHeadRevision,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
} from './memory-repository.ts'
import { extractFrontmatterAndLinks, type PalaceLayer, palaceLayerFor } from './memory-retrieval.ts'
import {
  allowedMemoryPath,
  isAlwaysLoadedTieredPath,
  isProtectedRetentionPath,
  utf8Bytes,
} from './memory-schema.ts'
import { memoryStateRootFor } from './memory-write-lock.ts'
import { FIXED_SHARED_OWNER, isSharedOwnerPath } from './shared-memory.ts'
import { resolveProjectSlug } from './workspace-identity.ts'

export type PalaceHistoryEntry = {
  revision: string
  parent: string | null
  committedAt: string
  subject: string
  changedFiles: number
  diff?: string
  diffTruncated?: boolean
}

export type ScopedHistoryResult = {
  revision: string | null
  project: string
  offset: number
  nextOffset: number | null
  entries: PalaceHistoryEntry[]
}

export type PalaceFileLastCommit = {
  revision: string
  subject: string
  committedAt: string
}

export type OfflinePalaceFile = {
  path: string
  layer: PalaceLayer
  bytes: number
  protectedRetention: boolean
  alwaysLoaded: boolean
  body: string
  name?: string
  description?: string
  readOnly?: boolean
  lastCommit?: PalaceFileLastCommit
}

export type OfflinePalaceRenderInput = {
  projectSlug: string
  revision: string
  capturedAt: string
  pluginVersion: string
  files: OfflinePalaceFile[]
  history: PalaceHistoryEntry[]
  modelLabel?: string
  contextWindowTokens?: number
  usedTokens?: number | null
  systemTokens?: number
}

export type OfflinePalaceExportResult = {
  filePath: string
  revision: string
  projectSlug: string
  coreCount: number
  externalCount: number
  historyCount: number
  bytes: number
}

const MAX_DIFF_PER_COMMIT_BYTES = 8192
const MAX_DIFF_AGGREGATE_BYTES = 128 * 1024

const agyPalaceMarkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="3" width="26" height="26" rx="7" fill="#0f172a"/><path d="M10 21.5L16 9.5L22 21.5H19.1L16 14.9L12.9 21.5H10Z" fill="#e2e8f0"/><circle cx="16" cy="21" r="1.8" fill="#818cf8"/></svg>'

const CONTEXT_BLOCK_COUNT = 480
const CONTEXT_KEYS = ['system', 'core', 'external', 'messages', 'free'] as const
type ContextKey = (typeof CONTEXT_KEYS)[number]

const CONTEXT_LABEL: Record<ContextKey, string> = {
  system: 'System',
  core: 'Core Memory',
  external: 'External Memory',
  messages: 'Messages',
  free: 'Free',
}

const CONTEXT_SYMBOL: Record<ContextKey, string> = {
  system: '\u25C9',
  core: '\u25C9',
  external: '\u25CF',
  messages: '\u25CF',
  free: '\u25A1',
}

function contextCoverageCss(): string {
  const fills = Array.from(
    { length: 101 },
    (_, step) => `.ctx-fill-${step} { inline-size: ${step}%; }`,
  ).join('\n')
  const hover = CONTEXT_KEYS.map(
    (key) => `
.context-grid:has([data-cat="${key}"]:hover) [data-cat="${key}"] { opacity: 1; filter: brightness(1.5); transform: scale(1.25); }
.context-grid:has([data-cat="${key}"]:hover) .block:not([data-cat="${key}"]) { opacity: 0.15; }
.context-layout:has(.context-grid [data-cat="${key}"]:hover) .ctx-legend-item:not([data-legend="${key}"]) { opacity: 0.25; }
.context-layout:has(.ctx-legend-item[data-legend="${key}"]:hover) .context-grid [data-cat="${key}"] { opacity: 1; filter: brightness(1.5); transform: scale(1.25); }
.context-layout:has(.ctx-legend-item[data-legend="${key}"]:hover) .context-grid .block:not([data-cat="${key}"]) { opacity: 0.15; }`,
  ).join('\n')
  return `${fills}\n${hover}`
}

export const offlinePalaceStyle = `
:root {
  color-scheme: light dark;
  --accent: hsl(240, 93%, 35%);
  --accent-light: hsl(240, 67%, 98%);
  --accent-light-border: hsl(240, 62%, 94%);
  --bg: #ffffff;
  --panel: #ffffff;
  --border: hsl(210, 10%, 92.2%);
  --text: hsl(0, 0%, 8%);
  --text-muted: hsl(210, 3%, 28%);
  --text-dim: hsl(210, 3%, 66%);
  --mono: 'Fira Code', Menlo, Courier, monospace;
  --sans: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  --radius: 6px;
  --max-w: 1180px;
  --surface: hsl(0, 0%, 98%);
  --surface-2: hsl(0, 0%, 96%);
  --hover: hsl(0, 0%, 96%);
  --hover-accent: hsl(240, 67%, 98%);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  color: var(--text);
  background: var(--bg);
  line-height: 1.55;
  font-weight: 400;
  font-size: 13px;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.app-shell {
  max-width: var(--max-w);
  margin: 22px auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 6px 16px rgba(0, 0, 0, 0.04);
}
.header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  gap: 12px;
  align-items: center;
}
.header-brand {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.product-mark {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #DED0FD;
  border-radius: 6px;
  flex: 0 0 auto;
}
.product-mark svg { width: 24px; height: 24px; display: block; }
.product-name {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.header h1, .header .agent-name {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  margin: 0;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.tab {
  padding: 10px 16px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  user-select: none;
  display: block;
}
.tab:hover { color: var(--text); }
.main { padding: 16px; }
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}
footer {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding: 10px 16px 14px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
nav ul { flex-wrap: wrap; list-style: none; }
.lede, .notice, .meta, .note { padding: 10px 14px; color: var(--text-muted); font-size: 12px; }
code, time { font-family: var(--mono); }
code { overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) {
  :root {
    --accent: hsl(240, 80%, 68%);
    --accent-light: hsl(240, 20%, 18%);
    --accent-light-border: hsl(240, 15%, 25%);
    --bg: hsl(0, 0%, 11%);
    --panel: hsl(0, 0%, 13%);
    --surface: hsl(0, 0%, 15%);
    --surface-2: hsl(0, 0%, 18%);
    --hover: hsl(0, 0%, 18%);
    --hover-accent: hsl(240, 15%, 20%);
    --border: hsl(210, 3%, 20%);
    --text: hsl(210, 7%, 84%);
    --text-muted: hsl(210, 3%, 60%);
    --text-dim: hsl(210, 3%, 42%);
  }
  .app-shell { box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 6px 16px rgba(0,0,0,0.3); }
  .tabs { background: var(--surface-2); }
}
@media (forced-colors: active) { .panel, .app-shell { border: 1px solid CanvasText; } }
.agent-meta { margin-left: auto; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.agent-id, .lc-meta, .file-chars, .dir-count { color: var(--text-dim); font-size: 11px; }
.view-radio, .file-radio, .raw-toggle-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.view { display: none; }
.app-shell:has(#view-context:checked) .view-context,
.app-shell:has(#view-core:checked) .view-core,
.app-shell:has(#view-external:checked) .view-external,
.app-shell:has(#view-history:checked) .view-history { display: block; }
.app-shell:has(#view-context:checked) label.tab[for="view-context"],
.app-shell:has(#view-core:checked) label.tab[for="view-core"],
.app-shell:has(#view-external:checked) label.tab[for="view-external"],
.app-shell:has(#view-history:checked) label.tab[for="view-history"] { color: var(--accent); background: var(--panel); box-shadow: inset 0 -2px 0 var(--accent); }
.view-radio:focus-visible ~ nav, .files-layout:has(.file-radio:focus-visible) .tree-panel,
.raw-toggle-input:focus-visible + .raw-toggle { outline: 2px solid var(--accent); outline-offset: -2px; }
.files-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; height: 74vh; }
.tree-panel { overflow: auto; min-width: 0; background: var(--surface-2); }
.file-panel { overflow: auto; min-width: 0; display: flex; flex-direction: column; }
.tree-desc { position: sticky; top: 0; padding: 8px 12px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-dim); z-index: 1; }
.tree-children { margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--border); }
.tree-dir > summary { list-style: none; }
.tree-dir > summary::-webkit-details-marker { display: none; }
.tree-dir > summary::before { content: "▸"; inline-size: 0.8rem; flex: 0 0 auto; color: var(--text-dim); }
.tree-dir[open] > summary::before { content: "▾"; }
.tree-item { display: flex; align-items: center; gap: 6px; padding: 5px 10px; cursor: pointer; overflow-wrap: anywhere; font-size: 13px; color: var(--text); user-select: none; }
.tree-item:hover { background: var(--hover-accent); }
.tree-item.dir { color: var(--text-muted); border-left: 2px solid var(--accent); }
.tree-file-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dir-count, .file-chars { margin-left: auto; flex: 0 0 auto; white-space: nowrap; }
.file-document { display: contents; }
.file-content { display: none; }
.file-radio:checked + .file-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.file-last-commit { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 12px; cursor: pointer; }
.file-last-commit:hover { background: var(--hover); }
.lc-hash, .commit-hash { font-family: var(--mono); font-size: 11px; color: var(--accent); background: var(--accent-light); border-radius: 4px; padding: 1px 6px; flex-shrink: 0; }
.lc-msg { flex: 1; overflow-wrap: anywhere; color: var(--text); }
.file-meta { position: relative; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
.file-path { font-family: var(--mono); font-size: 12px; color: var(--text); margin-bottom: 6px; padding-right: 54px; }
.meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0; }
.meta-pill { font-size: 12px; color: var(--text-muted); padding: 2px 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; overflow-wrap: anywhere; }
.meta-pill strong { color: var(--text); font-weight: 500; }
.raw-toggle { position: absolute; top: 8px; right: 10px; font-size: 11px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel); color: var(--text-muted); cursor: pointer; user-select: none; }
.raw-toggle:hover { background: var(--accent-light); color: var(--accent); }
.raw-toggle-input:checked + .raw-toggle { background: var(--accent); color: #fff; }
.file-body, .file-body-raw { padding: 20px 28px; overflow-wrap: anywhere; flex: 1; overflow: auto; }
.file-body { font-family: var(--serif); font-size: 16px; line-height: 1.65; }
.file-body h1, .file-body h2, .file-body h3, .file-body h4 { margin: 18px 0 8px; font-family: var(--serif); font-weight: 600; line-height: 1.3; color: var(--text); background: none; text-transform: none; letter-spacing: normal; padding: 0; border: 0; }
.file-body h1 { font-size: 28px; }
.file-body h2 { font-size: 22px; border-bottom: 1px solid var(--border); }
.file-body h3 { font-size: 18px; }
.file-body h4 { font-size: 16px; margin: 16px 0 6px; font-family: var(--serif); font-weight: 600; line-height: 1.3; color: var(--text); }
.file-body code { font-family: var(--mono); font-size: 13px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.file-body p, .file-body ul, .file-body ol, .file-body blockquote { margin: 10px 0; }
.file-body ul, .file-body ol { padding-left: 24px; }
.file-body blockquote { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--text-muted); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); }
.file-body pre { background: var(--surface-2); border-radius: 8px; padding: 12px; overflow: auto; }
.file-body pre code { background: transparent; border: 0; padding: 0; }
.file-body-raw { display: none; background: var(--surface-2); font-size: 13px; line-height: 1.6; }
.file-content:has(.raw-toggle-input:checked) .file-body { display: none; }
.file-content:has(.raw-toggle-input:checked) .file-body-raw { display: block; }
.context-panel { margin-bottom: 0; }
.context-layout { display: flex; min-height: 400px; min-width: 0; }
.context-grid-area { flex: 1; padding: 20px; display: flex; align-items: flex-start; justify-content: center; min-width: 0; }
.context-sidebar { width: 280px; min-width: 280px; padding: 20px; border-left: 1px solid var(--border); background: var(--surface); }
.context-grid { display: flex; flex-wrap: wrap; gap: 4px; max-width: min(700px, 100%); padding: 8px; }
.context-grid .block { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; user-select: none; transition: transform 0.1s ease, opacity 0.1s ease; }
.ctx-system { color: rgb(224, 112, 80); }
.ctx-core { color: rgb(224, 160, 64); }
.ctx-external { color: rgb(32, 178, 170); }
.ctx-messages { color: rgb(140, 140, 249); }
.ctx-free { color: var(--text-dim); opacity: .35; }
.ctx-model { font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 2px; overflow-wrap: anywhere; }
.ctx-model-sub { font-size: 11px; color: var(--text-dim); margin-bottom: 12px; }
.ctx-usage-label { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
.ctx-bar-track { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.ctx-bar-fill { height: 100%; border-radius: 3px; background: var(--accent); }
.ctx-bar-text { font-size: 11px; color: var(--text-dim); margin-bottom: 20px; }
.ctx-legend-title { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 10px; }
.ctx-legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; color: var(--text-muted); }
label.ctx-legend-item { cursor: pointer; }
label.ctx-legend-item:hover { color: var(--text); }
.ctx-legend-sym { font-size: 14px; width: 18px; text-align: center; flex: 0 0 auto; }
.ctx-legend-name { flex: 1; min-width: 0; }
.ctx-legend-arrow { font-size: 11px; color: var(--text-dim); margin-left: 4px; }
.ctx-legend-value { text-align: right; color: var(--text-dim); font-size: 11px; white-space: nowrap; }
${contextCoverageCss()}
.history-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.history-search-status { font-size: 12px; color: var(--text-dim); }
.commit-list { display: grid; gap: 10px; }
.commit-item { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
.commit-head { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 12px 14px; cursor: pointer; background: var(--surface); list-style: none; }
.commit-head::-webkit-details-marker { display: none; }
.commit-head:hover { background: var(--hover); }
.commit-left { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
.commit-center { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.commit-title { font-family: var(--sans); font-size: 13px; color: var(--text); }
.commit-preview, .commit-meta { color: var(--text-dim); font-size: 11px; }
.commit-body { border-top: 1px solid var(--border); padding: 8px 0; background: var(--panel); overflow: auto; }
.diff-bar { display: inline-flex; gap: 4px; align-items: center; font-size: 10px; }
.db-blocks { display: inline-flex; gap: 1px; margin-left: 2px; }
.db-block { display: inline-block; width: 6px; height: 6px; border-radius: 1px; background: var(--border); }
.db-block.add { background: #2da44e; }
.db-block.del { background: #cf222e; }
.db-plus { color: #1a7f37; }
.db-minus { color: #cf222e; }
.diff-line { display: block; padding: 0 12px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff-line.add { background: #dafbe1; color: #1a7f37; }
.diff-line.del { background: #ffebe9; color: #cf222e; }
.diff-line.hunk { background: #ddf4ff; color: var(--accent); }
.diff-line.hunk, .diff-file-header { padding: 2px 12px; }
.diff-file-header { color: var(--accent); font-weight: 500; background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin-top: 4px; }
@media (prefers-color-scheme: dark) {
  .db-plus { color: #7ee787; }
  .db-minus { color: #ffa198; }
  .diff-line.add { background: hsl(140, 30%, 14%); color: #7ee787; }
  .diff-line.del { background: hsl(0, 40%, 16%); color: #ffa198; }
  .diff-line.hunk { background: hsl(210, 30%, 16%); color: hsl(210, 40%, 70%); }
}
@media (max-width: 900px) { .files-layout { grid-template-columns: minmax(0, 1fr); height: auto; } .tree-panel { max-height: 32vh; } .file-panel { min-height: 42vh; } .context-layout { flex-direction: column; } .context-sidebar { width: auto; min-width: 0; border-left: 0; border-top: 1px solid var(--border); } }
@media (max-width: 600px) { .header { flex-wrap: wrap; } .agent-meta { text-align: left; margin-left: 0; } .main { padding: 8px; } .tab { padding: 10px; letter-spacing: 1px; } .commit-head { grid-template-columns: minmax(0, 1fr); } }
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}

function formatBytes(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k B`
  return `${value} B`
}

function formatShortDate(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function displayCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function utf8Preview(text: string, byteCap: number): { value: string; truncated: boolean } {
  let result = ''
  let size = 0
  let truncated = false
  for (const ch of text) {
    const chBytes = utf8Bytes(ch)
    if (size + chBytes > byteCap) {
      truncated = true
      break
    }
    result += ch
    size += chBytes
  }
  return { value: result, truncated }
}

function isCorePalaceFile(file: OfflinePalaceFile): boolean {
  if (file.layer === 'core' || file.layer === 'index') return true
  if (file.layer === 'system' || file.layer === 'projectSystem') {
    return !file.path.endsWith('/index.md')
  }
  if (file.layer === 'legacy') {
    return (
      file.path === 'global/human.md' ||
      file.path === 'global/persona.md' ||
      /^projects\/[a-z0-9][a-z0-9-]{0,99}\/(?:project|rules)\.md$/.test(file.path)
    )
  }
  return false
}

function splitFrontmatter(body: string): { text: string; badges: Array<[string, string]> } {
  const normalized = body.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return { text: normalized, badges: [] }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { text: normalized, badges: [] }
  const badges: Array<[string, string]> = []
  for (const line of lines.slice(1, end)) {
    const match = /^(name|description|limit|read_only):\s*(.*)$/.exec(line)
    if (match) badges.push([match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')])
  }
  return { text: lines.slice(end + 1).join('\n'), badges }
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text).replace(
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g,
    (_, code, strong, em) => {
      if (code !== undefined) return `<code>${code}</code>`
      if (strong !== undefined) return `<strong>${strong}</strong>`
      return `<em>${em}</em>`
    },
  )
}

function renderMarkdownBody(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index++] ?? ''
    if (!line.trim()) continue
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        code.push(lines[index++] ?? '')
      }
      if (index < lines.length) index++
      output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const list = /^\s*(?:([-*])|\d+\.)\s+(.*)$/.exec(line)
    if (list) {
      const ordered = !list[1]
      const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/
      const items = [list[2]]
      while (index < lines.length) {
        const next = pattern.exec(lines[index] ?? '')
        if (!next) break
        items.push(next[1])
        index++
      }
      const tag = ordered ? 'ol' : 'ul'
      output.push(
        `<${tag}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`,
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote = [line.replace(/^>\s?/, '')]
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index++] ?? '').replace(/^>\s?/, ''))
      }
      output.push(`<blockquote>${inlineMarkdown(quote.join('\n'))}</blockquote>`)
      continue
    }
    const paragraph = [line]
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(?:#{1,4}\s|\s*```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index] ?? '')
    ) {
      paragraph.push(lines[index++] ?? '')
    }
    output.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`)
  }
  return output.join('\n')
}

function visibleHistoryEntries(history: readonly PalaceHistoryEntry[]): PalaceHistoryEntry[] {
  return history.filter(
    (entry) =>
      entry.changedFiles > 0 ||
      Boolean(entry.diff) ||
      entry.subject === 'Out-of-scope project update',
  )
}

function allocateContextBlocks(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0) {
    return counts.map((_, index) => (index === counts.length - 1 ? CONTEXT_BLOCK_COUNT : 0))
  }
  const rows = counts.map((count) => {
    const exact = (count / total) * CONTEXT_BLOCK_COUNT
    return { count, floor: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  const blocks = rows.map((row) => row.floor)
  let left = CONTEXT_BLOCK_COUNT - blocks.reduce((sum, count) => sum + count, 0)
  const order = rows
    .map((row, index) => ({ index, frac: row.frac, count: row.count }))
    .sort((a, b) => b.frac - a.frac || b.count - a.count || a.index - b.index)
  for (const slot of order) {
    if (left <= 0) break
    blocks[slot.index] += 1
    left -= 1
  }
  for (let index = 0; index < blocks.length; index++) {
    if (counts[index] <= 0 || blocks[index] > 0) continue
    const donor = blocks.findIndex((value, donorIndex) => donorIndex !== index && value > 1)
    if (donor < 0) break
    blocks[donor] -= 1
    blocks[index] = 1
  }
  return blocks
}

function renderContextView(
  input: OfflinePalaceRenderInput,
  core: readonly OfflinePalaceFile[],
  external: readonly OfflinePalaceFile[],
): string {
  const coreBytes = core.reduce((sum, file) => sum + file.bytes, 0)
  const externalBytes = external.reduce((sum, file) => sum + file.bytes, 0)
  const coreTokens = coreBytes > 0 ? Math.max(1, Math.round(coreBytes / 4)) : 0
  const externalTokens = externalBytes > 0 ? Math.max(1, Math.round(externalBytes / 4)) : 0
  const measuredTokens = input.usedTokens ?? null
  const systemTokens = input.systemTokens ?? (measuredTokens !== null ? 8200 : 0)
  const windowTokens = input.contextWindowTokens ?? 200_000
  const usedTokens = Math.max(measuredTokens ?? 0, systemTokens + coreTokens)
  const messagesTokens = Math.max(0, usedTokens - systemTokens - coreTokens)
  const freeTokens = Math.max(0, windowTokens - usedTokens - externalTokens)

  const counts: Record<ContextKey, number> = {
    system: systemTokens,
    core: coreTokens,
    external: externalTokens,
    messages: messagesTokens,
    free: freeTokens,
  }
  const allocated = allocateContextBlocks(CONTEXT_KEYS.map((key) => counts[key]))
  const grid = CONTEXT_KEYS.flatMap((key, index) =>
    Array.from(
      { length: allocated[index] ?? 0 },
      () => `<span class="block ctx-${key}" data-cat="${key}">${CONTEXT_SYMBOL[key]}</span>`,
    ),
  ).join('')

  const model = input.modelLabel || `${input.projectSlug} (agy-memory-layer)`
  const fillStep = Math.max(0, Math.min(100, Math.round((usedTokens / windowTokens) * 100)))
  const usageLabel =
    measuredTokens !== null
      ? `${displayCount(usedTokens)} / ${displayCount(windowTokens)} tokens (${((usedTokens / windowTokens) * 100).toFixed(1)}%)`
      : `${formatBytes(coreBytes + externalBytes)} memory (${core.length + external.length} files)`
  const barText =
    measuredTokens !== null
      ? `${displayCount(freeTokens)} tokens available`
      : `${displayCount(core.length)} core · ${displayCount(external.length)} external`

  const legendItems = [
    counts.system > 0
      ? `<div class="ctx-legend-item" data-legend="system"><span class="ctx-legend-sym ctx-system" aria-hidden="true">${CONTEXT_SYMBOL.system}</span><span class="ctx-legend-name">${CONTEXT_LABEL.system}</span><span class="ctx-legend-value">~${displayCount(counts.system)} tok</span></div>`
      : '',
    `<label class="ctx-legend-item" for="view-core" data-legend="core"><span class="ctx-legend-sym ctx-core" aria-hidden="true">${CONTEXT_SYMBOL.core}</span><span class="ctx-legend-name">${CONTEXT_LABEL.core}<span class="ctx-legend-arrow" aria-hidden="true">→</span></span><span class="ctx-legend-value">${core.length} files (${formatBytes(coreBytes)})</span></label>`,
    `<label class="ctx-legend-item" for="view-external" data-legend="external"><span class="ctx-legend-sym ctx-external" aria-hidden="true">${CONTEXT_SYMBOL.external}</span><span class="ctx-legend-name">${CONTEXT_LABEL.external}<span class="ctx-legend-arrow" aria-hidden="true">→</span></span><span class="ctx-legend-value">${external.length} files (${formatBytes(externalBytes)})</span></label>`,
    counts.messages > 0
      ? `<div class="ctx-legend-item" data-legend="messages"><span class="ctx-legend-sym ctx-messages" aria-hidden="true">${CONTEXT_SYMBOL.messages}</span><span class="ctx-legend-name">${CONTEXT_LABEL.messages}</span><span class="ctx-legend-value">~${displayCount(counts.messages)} tok</span></div>`
      : '',
    `<div class="ctx-legend-item" data-legend="free"><span class="ctx-legend-sym ctx-free" aria-hidden="true">${CONTEXT_SYMBOL.free}</span><span class="ctx-legend-name">${CONTEXT_LABEL.free}</span><span class="ctx-legend-value">${((freeTokens / windowTokens) * 100).toFixed(1)}%</span></div>`,
  ].join('')

  return `<div class="panel context-panel"><div class="context-layout"><div class="context-grid-area"><div class="context-grid" aria-hidden="true">${grid}</div></div><aside class="context-sidebar"><div class="ctx-model">${escapeHtml(model)}</div><div class="ctx-model-sub">${escapeHtml(input.projectSlug)} · ${escapeHtml(input.revision.slice(0, 7))}</div><div class="ctx-usage-label">${escapeHtml(usageLabel)}</div><div class="ctx-bar-track" aria-hidden="true"><div class="ctx-bar-fill ctx-fill-${fillStep}"></div></div><div class="ctx-bar-text">${escapeHtml(barText)}</div><div class="ctx-legend-title">Composition</div>${legendItems}</aside></div></div>`
}

function renderFileWorkspace(
  files: readonly OfflinePalaceFile[],
  group: 'core' | 'external',
  input: OfflinePalaceRenderInput,
): string {
  type Tree = {
    folders: Map<string, Tree>
    files: Array<{ file: OfflinePalaceFile; index: number; name: string }>
    count: number
  }
  const makeNode = (): Tree => ({ folders: new Map(), files: [], count: 0 })
  const root = makeNode()
  files.forEach((file, index) => {
    const displayPath =
      group === 'core' ? file.path.replace(/^system\//, '') : file.path.replace(/^projects\//, '')
    const parts = displayPath.split('/')
    let current = root
    current.count++
    for (const part of parts.slice(0, -1)) {
      let child = current.folders.get(part)
      if (!child) {
        child = makeNode()
        current.folders.set(part, child)
      }
      child.count++
      current = child
    }
    current.files.push({ file, index, name: parts.at(-1) ?? file.path })
  })

  const renderTree = (current: Tree, prefix = ''): string => {
    const folders = [...current.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        const folderPath = prefix ? `${prefix}/${name}` : name
        return `<details class="tree-dir" data-palace-folder="${escapeHtml(folderPath)}" open><summary class="tree-item dir"><span class="tree-file-name">${escapeHtml(name)}/</span><span class="dir-count">${child.count}</span></summary><div class="tree-children">${renderTree(child, folderPath)}</div></details>`
      })
      .join('')
    return (
      folders +
      current.files
        .map(({ file, index, name }) => {
          const cleanName = name.replace(/\.md$/, '')
          const sizeLabel = formatBytes(file.bytes)
          return `<label class="tree-item file" data-palace-path="${escapeHtml(file.path)}" for="${group}-file-${index}"><span class="tree-file-name">${escapeHtml(cleanName)}</span><span class="file-chars">${sizeLabel}</span></label>`
        })
        .join('')
    )
  }

  const visibleHistory = visibleHistoryEntries(input.history)
  const commitForFile = (filePath: string) =>
    visibleHistory.find((entry) => {
      const lines = (entry.diff ?? '').split('\n')
      return (
        lines.includes(`+++ b/${filePath}`) ||
        lines.includes(`+++ ${filePath}`) ||
        lines.includes(`--- a/${filePath}`) ||
        lines.includes(`--- ${filePath}`)
      )
    }) ?? visibleHistory[0]

  const documents = files
    .map((file, index) => {
      const latest = file.lastCommit ?? commitForFile(file.path)
      const parsed = splitFrontmatter(file.body)
      const pills = [
        ...parsed.badges.map(
          ([key, value]) =>
            `<span class="meta-pill">${escapeHtml(key)}: <strong>${escapeHtml(value)}</strong></span>`,
        ),
        `<span class="meta-pill">size: <strong>${displayCount(file.bytes)} B</strong></span>`,
      ].join('')
      return `<article class="file-document"><input class="file-radio" type="radio" name="${group}-file" id="${group}-file-${index}"${index === 0 ? ' checked' : ''} aria-label="${escapeHtml(file.path)}"><div class="file-content">
<label class="file-last-commit" for="view-history"><span class="lc-hash">${escapeHtml((latest?.revision ?? input.revision).slice(0, 7))}</span><span class="lc-msg">${escapeHtml(latest?.subject ?? 'Committed snapshot')}</span><time class="lc-meta" datetime="${escapeHtml(latest?.committedAt ?? input.capturedAt)}">${escapeHtml(formatShortDate(latest?.committedAt ?? input.capturedAt))}</time></label>
<div class="file-meta"><div class="file-path"><code>${escapeHtml(file.path)}</code></div><div class="meta-row">${pills}</div><input class="raw-toggle-input" type="checkbox" id="raw-${group}-${index}"><label class="raw-toggle" for="raw-${group}-${index}">Raw</label></div>
<div class="file-body">${renderMarkdownBody(parsed.text)}</div>
<div class="file-body-raw"><pre><code>${escapeHtml(file.body).replace(/\r/g, '&#13;')}</code></pre></div>
</div></article>`
    })
    .join('')

  const fallback = '<p class="lede">No files in this section.</p>'
  return `<div class="files-layout"><aside class="panel tree-panel" aria-label="${group} files"><div class="tree-desc">${group === 'core' ? 'Memory stored in-context' : 'Memory stored out-of-context'}</div>${renderTree(root) || '<p class="lede">No files.</p>'}</aside><div class="panel file-panel" aria-label="Selected ${group} document">${documents || fallback}</div></div>`
}

function renderCommitCards(history: readonly PalaceHistoryEntry[]): string {
  const entries = visibleHistoryEntries(history)
  if (!entries.length) return '<div class="panel"><p class="lede">No commits yet.</p></div>'
  return `<div class="history-toolbar"><span class="history-search-status">${entries.length} recent commit${entries.length === 1 ? '' : 's'}</span></div><div class="commit-list">${entries
    .map((entry, index) => {
      const lines = (entry.diff ?? '').split('\n')
      const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
      const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
      const total = added + removed
      const addBlocks = total ? Math.round((added / total) * 5) : 0
      const blocks = Array.from(
        { length: 5 },
        (_, block) =>
          `<i class="db-block${total ? (block < addBlocks ? ' add' : ' del') : ''}"></i>`,
      ).join('')
      const diff = lines
        .map((line) => {
          const kind = line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+++') || line.startsWith('---')
              ? 'diff-file-header'
              : line.startsWith('+')
                ? 'add'
                : line.startsWith('-')
                  ? 'del'
                  : ''
          return `<span class="diff-line ${kind}">${escapeHtml(line)}</span>`
        })
        .join('')
      return `<details class="commit-item"${index === 0 ? ' open' : ''}><summary class="commit-head"><span class="commit-left"><span class="commit-hash">${escapeHtml(entry.revision.slice(0, 7))}</span><span class="diff-bar"><span class="db-plus">+${added}</span><span class="db-minus">−${removed}</span><span class="db-blocks">${blocks}</span></span></span><span class="commit-center"><span class="commit-title">${escapeHtml(entry.subject)}</span><span class="commit-preview">${entry.changedFiles} file${entry.changedFiles === 1 ? '' : 's'} changed</span></span><time class="commit-meta" datetime="${escapeHtml(entry.committedAt)}">${escapeHtml(formatShortDate(entry.committedAt))}</time></summary><div class="commit-body"><pre>${entry.diff ? diff : '<span class="diff-line">No diff preview.</span>'}</pre>${entry.diffTruncated ? '<p class="note">Commit diff (truncated)</p>' : ''}</div></details>`
    })
    .join('')}</div>`
}

export function renderOfflinePalaceHtml(input: OfflinePalaceRenderInput): string {
  const core = input.files.filter(isCorePalaceFile)
  const external = input.files.filter((file) => !isCorePalaceFile(file))
  const views = [
    ['context', 'Context'],
    ['core', `Core Memory (${core.length})`],
    ['external', `External Memory (${external.length})`],
    ['history', 'History'],
  ] as const
  const viewInputs = views
    .map(
      ([id], index) =>
        `<input class="view-radio" type="radio" name="palace-view" id="view-${id}"${index === 0 ? ' checked' : ''} aria-label="${id} view">`,
    )
    .join('')
  const viewTabs = views
    .map(([id, title]) => `<li><label class="tab" for="view-${id}">${title}</label></li>`)
    .join('')
  const selectionCss = [core, external]
    .flatMap((groupFiles, groupIdx) =>
      groupFiles.map((_, index) => {
        const id = `${groupIdx ? 'external' : 'core'}-file-${index}`
        return `.files-layout:has([id="${id}"]:checked) [for="${id}"] { background: var(--accent-light); color: var(--accent); font-weight: 600; box-shadow: inset 2px 0 0 var(--accent); }`
      }),
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.projectSlug)}'s Memory Palace | agy-memory-layer</title>
<style>${offlinePalaceStyle}\n${selectionCss}</style>
</head>
<body>
<div class="app-shell">
<header class="header">
<div class="header-brand">
<span class="product-mark" aria-hidden="true">${agyPalaceMarkSvg}</span>
<span class="product-name">agy-memory-layer v${escapeHtml(input.pluginVersion)}</span>
</div>
<div class="agent-meta"><h1 class="agent-name">${escapeHtml(input.projectSlug)}'s Memory Palace</h1><div class="agent-id">${escapeHtml(input.revision.slice(0, 7))}</div></div>
</header>
${viewInputs}
<nav aria-label="Page sections"><ul class="tabs">${viewTabs}</ul></nav>
<main id="content" class="main">
<div class="view view-context" aria-label="Context">${renderContextView(input, core, external)}</div>
<div class="view view-core" aria-label="Core Memory">${renderFileWorkspace(core, 'core', input)}</div>
<div class="view view-external" aria-label="External Memory">${renderFileWorkspace(external, 'external', input)}</div>
<div class="view view-history" aria-label="History">${renderCommitCards(input.history)}</div>
</main>
<footer>Captured <time datetime="${escapeHtml(input.capturedAt)}">${escapeHtml(formatShortDate(input.capturedAt))}</time> · Persistent private offline snapshot; exported bytes remain until removed by you</footer>
</div>
</body>
</html>`
}

export function readScopedMemoryHistory(options: {
  memoryRoot: string
  projectSlug: string
  offset?: number
  limit?: number
}): ScopedHistoryResult {
  const revision = getMemoryHeadRevision(options.memoryRoot)
  const offset = Math.max(0, options.offset ?? 0)
  const limit = Math.min(32, Math.max(1, options.limit ?? 32))
  if (!revision) {
    return { revision: null, project: options.projectSlug, offset, nextOffset: null, entries: [] }
  }

  let logOut = ''
  try {
    logOut = execFileSync(
      'git',
      [
        '-C',
        options.memoryRoot,
        'log',
        '--first-parent',
        `--skip=${offset}`,
        `--max-count=${limit + 1}`,
        '--format=%H%x09%P%x09%ct%x09%s',
        'HEAD',
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    ).trim()
  } catch {
    return { revision, project: options.projectSlug, offset, nextOffset: null, entries: [] }
  }

  if (!logOut) {
    return { revision, project: options.projectSlug, offset, nextOffset: null, entries: [] }
  }

  const rows = logOut.split('\n').filter(Boolean)
  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  const entries: PalaceHistoryEntry[] = []
  let aggregateDiffBytes = 0

  for (const row of pageRows) {
    const [commitRev, parentsRaw = '', tsRaw = '0', ...subjectParts] = row.split('\t')
    if (!commitRev) continue
    const parent = parentsRaw.trim().split(' ').filter(Boolean)[0] ?? null
    const seconds = Number.parseInt(tsRaw, 10) || 0
    const committedAt = new Date(seconds * 1000).toISOString()
    const rawSubject = subjectParts.join('\t').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')

    let changedPaths: string[] = []
    try {
      const filesOut = execFileSync(
        'git',
        [
          '-C',
          options.memoryRoot,
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '--root',
          '-z',
          commitRev,
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
      )
      changedPaths = filesOut
        .split('\0')
        .filter(
          (candidate) =>
            Boolean(candidate) && candidate !== '.memory.json' && candidate !== '.gitignore',
        )
    } catch {
      changedPaths = []
    }

    const inScopePaths = changedPaths.filter((candidate) =>
      allowedMemoryPath(candidate, options.projectSlug),
    )
    const redacted = changedPaths.some(
      (candidate) => !allowedMemoryPath(candidate, options.projectSlug),
    )
    const subjectPreview = redacted
      ? 'Out-of-scope project update'
      : utf8Preview(rawSubject, 256).value

    let diff: string | undefined
    let diffTruncated: boolean | undefined
    if (!redacted && inScopePaths.length > 0 && aggregateDiffBytes < MAX_DIFF_AGGREGATE_BYTES) {
      try {
        const rawDiff = execFileSync(
          'git',
          [
            '-C',
            options.memoryRoot,
            'show',
            '--format=',
            '--unified=3',
            '--no-ext-diff',
            '--no-textconv',
            '--no-renames',
            '--root',
            commitRev,
            '--',
            ...inScopePaths,
          ],
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
        ).trimEnd()
        if (rawDiff) {
          const remaining = MAX_DIFF_AGGREGATE_BYTES - aggregateDiffBytes
          const cap = Math.min(MAX_DIFF_PER_COMMIT_BYTES, remaining)
          const preview = utf8Preview(rawDiff, cap)
          diff = preview.value
          diffTruncated = preview.truncated
          aggregateDiffBytes += utf8Bytes(diff)
        }
      } catch {
        // Ignore individual diff failure
      }
    }

    entries.push({
      revision: commitRev,
      parent,
      committedAt,
      subject: subjectPreview || 'Memory update',
      changedFiles: inScopePaths.length,
      ...(diff !== undefined ? { diff, diffTruncated: Boolean(diffTruncated) } : {}),
    })
  }

  return {
    revision,
    project: options.projectSlug,
    offset,
    nextOffset: hasMore ? offset + pageRows.length : null,
    entries,
  }
}

function readPluginVersion(): string {
  try {
    const manifestPath = path.resolve(import.meta.dirname, '..', 'plugin.json')
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: unknown }
    if (typeof parsed.version === 'string' && parsed.version.trim()) return parsed.version.trim()
  } catch {
    // Fallback below
  }
  return '1.25.0'
}

function readFileLastCommit(
  memoryRoot: string,
  relativePath: string,
): PalaceFileLastCommit | undefined {
  try {
    const out = execFileSync(
      'git',
      ['-C', memoryRoot, 'log', '-1', '--format=%H%x09%ct%x09%s', '--', relativePath],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    ).trim()
    if (!out) return undefined
    const [revision = '', tsRaw = '0', ...subjectParts] = out.split('\t')
    if (!revision) return undefined
    const seconds = Number.parseInt(tsRaw, 10) || 0
    const committedAt = new Date(seconds * 1000).toISOString()
    const rawSubject = subjectParts.join('\t').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    const subject = utf8Preview(rawSubject, 256).value || 'Memory update'
    return { revision, subject, committedAt }
  } catch {
    return undefined
  }
}

function measureAgyConversationTokens(conversationId?: string): {
  usedTokens: number
  contextWindowTokens?: number
  modelLabel?: string
} | null {
  if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(conversationId)) {
    return null
  }
  try {
    const transcriptPath = path.join(
      os.homedir(),
      '.gemini',
      'antigravity-cli',
      'brain',
      conversationId,
      '.system_generated',
      'logs',
      'transcript.jsonl',
    )
    if (!fs.existsSync(transcriptPath)) return null
    const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean)
    if (lines.length === 0) return null
    let lastCheckpointIdx = 0
    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i] ?? '') as { content?: unknown }
        if (typeof entry.content === 'string' && entry.content.includes('{{ CHECKPOINT')) {
          lastCheckpointIdx = i
        }
      } catch {
        // Ignore malformed transcript line
      }
    }
    let totalChars = 0
    for (let i = lastCheckpointIdx; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i] ?? '') as {
          content?: unknown
          tool_calls?: unknown
        }
        const contentLen = typeof entry.content === 'string' ? entry.content.length : 0
        const toolCallsLen =
          entry.tool_calls !== undefined ? JSON.stringify(entry.tool_calls).length : 0
        totalChars += contentLen + toolCallsLen
      } catch {
        // Ignore malformed transcript line
      }
    }
    if (totalChars <= 0) return null
    return { usedTokens: Math.max(1, Math.round(totalChars / 3.5)) }
  } catch {
    return null
  }
}

export function exportOfflinePalaceHtml(options: {
  memoryRoot: string
  projectSlug: string
  outputPath?: string
  conversationId?: string
}): OfflinePalaceExportResult {
  const projection = inspectCommittedMemoryProjection(options.memoryRoot, options.projectSlug)
  if (projection.mode === 'conflict') {
    throw new Error(
      `Memory Palace refuses mixed legacy/layered ownership:\n${projection.diagnostics.join('\n')}`,
    )
  }

  const capturedAt = new Date().toISOString()
  const revision = getMemoryHeadRevision(options.memoryRoot) ?? '0'.repeat(40)
  const committedPaths = listCommittedMemoryFiles(options.memoryRoot, '')
    .filter(
      (candidate) =>
        candidate.endsWith('.md') &&
        !candidate.startsWith('archives/') &&
        allowedMemoryPath(candidate, options.projectSlug),
    )
    .sort()

  const files: OfflinePalaceFile[] = []
  for (const relativePath of committedPaths) {
    const body = readCommittedMemoryFile(options.memoryRoot, relativePath)
    if (body === null) continue
    const meta = extractFrontmatterAndLinks(body)
    const lastCommit = readFileLastCommit(options.memoryRoot, relativePath)
    files.push({
      path: relativePath,
      layer: palaceLayerFor(relativePath),
      bytes: utf8Bytes(body),
      protectedRetention: isProtectedRetentionPath(relativePath),
      alwaysLoaded: isAlwaysLoadedTieredPath(relativePath, options.projectSlug),
      body,
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.readOnly !== undefined ? { readOnly: meta.readOnly } : {}),
      ...(lastCommit ? { lastCommit } : {}),
    })
  }

  if (projection.sharedSource) {
    const sharedDoc = projection.globalSystem.find((d) => isSharedOwnerPath(d.relativePath))
    if (sharedDoc) {
      const mergedBody = `---\ndescription: ${sharedDoc.description}\n---\n${sharedDoc.body}\n`
      const sharedEntry: OfflinePalaceFile = {
        path: FIXED_SHARED_OWNER,
        layer: palaceLayerFor(FIXED_SHARED_OWNER),
        bytes: utf8Bytes(mergedBody),
        protectedRetention: isProtectedRetentionPath(FIXED_SHARED_OWNER),
        alwaysLoaded: isAlwaysLoadedTieredPath(FIXED_SHARED_OWNER, options.projectSlug),
        body: mergedBody,
        ...(sharedDoc.name ? { name: sharedDoc.name } : {}),
        description: sharedDoc.description,
        readOnly: sharedDoc.readOnly,
        lastCommit: {
          revision: projection.sharedSource.pinnedSha,
          subject: 'Shared communication projection (pinned source HEAD)',
          committedAt: capturedAt,
        },
      }
      const existingIdx = files.findIndex((f) => f.path === FIXED_SHARED_OWNER)
      if (existingIdx >= 0) {
        files[existingIdx] = sharedEntry
      } else {
        files.push(sharedEntry)
        files.sort((a, b) => a.path.localeCompare(b.path))
      }
    }
  }

  const history = readScopedMemoryHistory({
    memoryRoot: options.memoryRoot,
    projectSlug: options.projectSlug,
    offset: 0,
    limit: 32,
  }).entries

  const measured = measureAgyConversationTokens(options.conversationId)
  const html = renderOfflinePalaceHtml({
    projectSlug: options.projectSlug,
    revision,
    capturedAt,
    pluginVersion: readPluginVersion(),
    files,
    history,
    ...(measured ? { usedTokens: measured.usedTokens } : {}),
  })

  const viewersDir = path.join(memoryStateRootFor(options.memoryRoot), 'viewers')
  const targetPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(viewersDir, `palace-${options.projectSlug}.html`)
  const targetDir = path.dirname(targetPath)
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, html, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tempPath, targetPath)

  const coreCount = files.filter(isCorePalaceFile).length
  const externalCount = files.length - coreCount
  return {
    filePath: targetPath,
    revision,
    projectSlug: options.projectSlug,
    coreCount,
    externalCount,
    historyCount: history.length,
    bytes: utf8Bytes(html),
  }
}

if (isDirectCliInvocation(import.meta.url)) {
  const workspace = process.argv[2] || process.cwd()
  const rawOutput = process.argv[3]
  const outputPath = rawOutput && rawOutput.trim().length > 0 ? rawOutput : undefined
  const conversationId = process.argv[4] || process.env.CONVERSATION_ID || undefined
  const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)
  const result = exportOfflinePalaceHtml({ memoryRoot, projectSlug, outputPath, conversationId })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
