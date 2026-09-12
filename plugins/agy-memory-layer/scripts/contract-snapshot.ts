import { spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type OwnerRole = 'hub' | 'spoke'
export type OwnerManifestEntry = {
  path: string
  role: OwnerRole
  contentHash: string
}
export type EvidenceClass =
  | 'current-user'
  | 'historical-user'
  | 'repo-current'
  | 'runtime-current'
  | 'agent-summary'
  | 'memory-supporting'
export type ProposalEvidence = {
  class: EvidenceClass
  source: string
  locator?: string
  excerpt?: string
}
export type ProposalTruthClass =
  | 'observed-reality'
  | 'accepted-requirement'
  | 'unresolved-direction'
export type ProposalDisposition =
  | 'keep'
  | 'clarify'
  | 'add'
  | 'merge'
  | 'move'
  | 'historical'
  | 'remove'
export type RetrievalCoverage = {
  sources: string[]
  timeRange: string
  queries: string[]
  gaps: string[]
}
export type RefineProposalItem = {
  id: string
  paths: string[]
  summary: string
  truthClass: ProposalTruthClass
  disposition: ProposalDisposition
  evidence: ProposalEvidence[]
}
export type RefineProposal = {
  version: '1.0.0'
  id: string
  retrieval: RetrievalCoverage
  finalOwners: OwnerManifestEntry[]
  items: RefineProposalItem[]
}
export type RefineApproval = {
  version: '1.0.0'
  proposalId: string
  proposalHash: string
  decision: 'approved'
  approvedItemIds: string[]
  approvedBy: string
  decisionLocator: string
  approvedAt?: string
  statement?: string
}
export type ContractSnapshot = {
  version: '1.0.0'
  createdAt: string
  owners: OwnerManifestEntry[]
  sourcesHash: string
  rulesDigest: string
  contractHash: string
  snapshotHash: string
  approvedDirtyPaths: string[]
  proposal: RefineProposal
  approval: RefineApproval
  approvalAuthentication: 'not-authenticated'
  ledger: unknown
}
export type SnapshotVerification = {
  passed: boolean
  errors: string[]
}
export type TargetManifestEntry = {
  path: string
  contentHash: string
}

const PRIMARY_EVIDENCE = new Set<EvidenceClass>([
  'current-user',
  'historical-user',
  'repo-current',
  'runtime-current',
])
const EVIDENCE_CLASSES = new Set<EvidenceClass>([
  ...PRIMARY_EVIDENCE,
  'agent-summary',
  'memory-supporting',
])

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function collectMarkdown(dir: string, repoRoot: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const relative = path.relative(repoRoot, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (!/(^|\/)(releases|history|archive)(\/|$)/.test(relative)) {
        files.push(...collectMarkdown(full, repoRoot))
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

export function buildOwnerManifest(repoRoot: string): OwnerManifestEntry[] {
  const owners: Array<{ absolute: string; role: OwnerRole }> = []
  const hub = path.join(repoRoot, 'AGENTS.md')
  if (fs.existsSync(hub)) owners.push({ absolute: hub, role: 'hub' })
  for (const absolute of collectMarkdown(path.join(repoRoot, 'docs'), repoRoot)) {
    owners.push({ absolute, role: 'spoke' })
  }
  return owners
    .map(({ absolute, role }) => ({
      path: path.relative(repoRoot, absolute).replace(/\\/g, '/'),
      role,
      contentHash: sha256(fs.readFileSync(absolute)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role))
}

export function computeSourcesHash(owners: OwnerManifestEntry[]): string {
  return sha256(
    owners.map((owner) => `${owner.path}\0${owner.role}\0${owner.contentHash}`).join('\n'),
  )
}

export function computeRulesDigest(ledger: unknown): string {
  if (!ledger || typeof ledger !== 'object') return sha256('null')
  const record = ledger as Record<string, unknown>
  return sha256(stableJson({ rules: record.rules, allowlists: record.allowlists }))
}

export function computeProposalHash(proposal: RefineProposal): string {
  return sha256(stableJson(proposal))
}

function assertString(value: unknown, label: string, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`)
  }
}

function normalizeRepoPath(repoRoot: string, candidate: string): string {
  assertString(candidate, 'proposal path', 500)
  const absolute = path.resolve(repoRoot, candidate)
  const relative = path.relative(repoRoot, absolute).replace(/\\/g, '/')
  if (relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`proposal path escapes repository: ${candidate}`)
  }
  return relative
}

export function validateProposalApproval(
  repoRoot: string,
  proposal: RefineProposal,
  approval: RefineApproval,
  dirtyOwnerPaths: string[],
): void {
  if (proposal?.version !== '1.0.0' || !Array.isArray(proposal.items)) {
    throw new Error('proposal must use version 1.0.0 and contain items')
  }
  assertString(proposal.id, 'proposal.id', 100)
  if (!Array.isArray(proposal.finalOwners) || proposal.finalOwners.length === 0) {
    throw new Error('proposal.finalOwners must contain the complete active owner manifest')
  }
  const sortedFinalOwners = [...proposal.finalOwners].sort(
    (a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role),
  )
  if (stableJson(sortedFinalOwners) !== stableJson(proposal.finalOwners)) {
    throw new Error('proposal.finalOwners must be canonically sorted')
  }
  const seenFinalOwners = new Set<string>()
  for (const owner of proposal.finalOwners) {
    if (
      !owner ||
      typeof owner.path !== 'string' ||
      !isActiveOwnerPath(owner.path) ||
      !['hub', 'spoke'].includes(owner.role) ||
      !/^[a-f0-9]{64}$/.test(owner.contentHash)
    ) {
      throw new Error('proposal.finalOwners contains a malformed active owner')
    }
    if (seenFinalOwners.has(owner.path))
      throw new Error(`duplicate final owner path: ${owner.path}`)
    seenFinalOwners.add(owner.path)
  }
  const liveOwners = buildOwnerManifest(repoRoot)
  if (stableJson(liveOwners) !== stableJson(proposal.finalOwners)) {
    throw new Error('current active owner manifest does not match proposal.finalOwners')
  }
  if (proposal.items.length === 0 || proposal.items.length > 100) {
    throw new Error('proposal must contain between 1 and 100 items')
  }
  if (!proposal.retrieval || typeof proposal.retrieval !== 'object') {
    throw new Error('proposal.retrieval is required')
  }
  const boundedLists: Array<[string, unknown, number]> = [
    ['proposal.retrieval.sources', proposal.retrieval.sources, 50],
    ['proposal.retrieval.queries', proposal.retrieval.queries, 50],
    ['proposal.retrieval.gaps', proposal.retrieval.gaps, 50],
  ]
  for (const [label, values, maximum] of boundedLists) {
    if (!Array.isArray(values) || values.length > maximum)
      throw new Error(`${label} must contain at most ${maximum} entries`)
    for (const value of values) assertString(value, label, 500)
  }
  assertString(proposal.retrieval.timeRange, 'proposal.retrieval.timeRange', 500)
  if (approval?.version !== '1.0.0' || !Array.isArray(approval.approvedItemIds)) {
    throw new Error('approval must use version 1.0.0 and contain approvedItemIds')
  }
  assertString(approval.proposalId, 'approval.proposalId', 100)
  assertString(approval.proposalHash, 'approval.proposalHash', 64)
  if (approval.decision !== 'approved') throw new Error('approval.decision must be approved')
  assertString(approval.approvedBy, 'approval.approvedBy', 200)
  assertString(approval.decisionLocator, 'approval.decisionLocator', 500)
  if (
    approval.proposalId !== proposal.id ||
    approval.proposalHash !== computeProposalHash(proposal)
  ) {
    throw new Error('approval does not bind the exact proposal ID and hash')
  }
  if (approval.statement !== undefined) assertString(approval.statement, 'approval.statement', 1000)
  if (approval.approvedAt !== undefined)
    assertString(approval.approvedAt, 'approval.approvedAt', 100)

  const itemIds = new Set<string>()
  const approvedIds = new Set(approval.approvedItemIds)
  const approvedPaths = new Set<string>()
  for (const item of proposal.items) {
    assertString(item.id, 'proposal item id', 100)
    if (itemIds.has(item.id)) throw new Error(`duplicate proposal item id: ${item.id}`)
    itemIds.add(item.id)
    assertString(item.summary, `proposal item ${item.id} summary`, 1000)
    if (
      !['observed-reality', 'accepted-requirement', 'unresolved-direction'].includes(
        item.truthClass,
      )
    ) {
      throw new Error(`proposal item ${item.id} has an invalid truth class`)
    }
    if (
      !['keep', 'clarify', 'add', 'merge', 'move', 'historical', 'remove'].includes(
        item.disposition,
      )
    ) {
      throw new Error(`proposal item ${item.id} has an invalid disposition`)
    }
    if (approvedIds.has(item.id) && item.truthClass === 'unresolved-direction') {
      throw new Error(`approved proposal item ${item.id} is unresolved direction`)
    }
    if (!Array.isArray(item.paths) || item.paths.length === 0 || item.paths.length > 50) {
      throw new Error(`proposal item ${item.id} must contain 1-50 paths`)
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.length > 20) {
      throw new Error(`proposal item ${item.id} must contain 1-20 evidence entries`)
    }
    let hasPrimary = false
    for (const evidence of item.evidence) {
      if (!evidence || !EVIDENCE_CLASSES.has(evidence.class)) {
        throw new Error(`proposal item ${item.id} has an invalid evidence class`)
      }
      assertString(evidence.source, `proposal item ${item.id} evidence source`, 500)
      if (evidence.locator !== undefined) assertString(evidence.locator, 'evidence locator', 500)
      if (
        (evidence.class === 'current-user' || evidence.class === 'historical-user') &&
        evidence.locator === undefined
      ) {
        throw new Error(`proposal item ${item.id} user evidence requires an exact locator`)
      }
      if (evidence.excerpt !== undefined) assertString(evidence.excerpt, 'evidence excerpt', 1000)
      if (PRIMARY_EVIDENCE.has(evidence.class)) hasPrimary = true
    }
    if (approvedIds.has(item.id)) {
      if (!hasPrimary) {
        throw new Error(`approved proposal item ${item.id} lacks primary evidence`)
      }
      for (const itemPath of item.paths) approvedPaths.add(normalizeRepoPath(repoRoot, itemPath))
    }
  }
  for (const approvedId of approvedIds) {
    if (!itemIds.has(approvedId)) throw new Error(`approval references unknown item: ${approvedId}`)
  }
  for (const dirtyPath of dirtyOwnerPaths) {
    if (!approvedPaths.has(dirtyPath)) {
      throw new Error(
        `dirty contract owner is not covered by an approved proposal item: ${dirtyPath}`,
      )
    }
  }
}

export function gitDirtyPaths(repoRoot: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`cannot inspect Git baseline: ${result.stderr.trim()}`)
  const entries = result.stdout.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const status = entry.slice(0, 2)
    paths.push(entry.slice(3).replace(/\\/g, '/'))
    if (status.includes('R') || status.includes('C')) {
      const otherSide = entries[index + 1]
      if (otherSide) paths.push(otherSide.replace(/\\/g, '/'))
      index++
    }
  }
  return [...new Set(paths)].sort()
}

function isActiveOwnerPath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/')
  if (normalized === 'AGENTS.md') return true
  return (
    normalized.startsWith('docs/') &&
    normalized.endsWith('.md') &&
    !/(^|\/)(releases|history|archive)(\/|$)/.test(normalized)
  )
}

function snapshotPayload(snapshot: Omit<ContractSnapshot, 'snapshotHash'>): unknown {
  return snapshot
}

export function createContractSnapshot(
  repoRoot: string,
  ledger: unknown,
  proposal: RefineProposal,
  approval: RefineApproval,
): ContractSnapshot {
  const owners = buildOwnerManifest(repoRoot)
  if (!owners.some((owner) => owner.role === 'hub')) throw new Error('AGENTS.md is required')
  const dirtyOwnerPaths = gitDirtyPaths(repoRoot).filter(isActiveOwnerPath)
  validateProposalApproval(repoRoot, proposal, approval, dirtyOwnerPaths)
  const sourcesHash = computeSourcesHash(proposal.finalOwners)
  const rulesDigest = computeRulesDigest(ledger)
  const withoutHash: Omit<ContractSnapshot, 'snapshotHash'> = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    owners,
    sourcesHash,
    rulesDigest,
    contractHash: sha256(`${sourcesHash}\0${rulesDigest}`),
    approvedDirtyPaths: dirtyOwnerPaths,
    proposal,
    approval,
    approvalAuthentication: 'not-authenticated',
    ledger,
  }
  return { ...withoutHash, snapshotHash: sha256(stableJson(snapshotPayload(withoutHash))) }
}

export function verifyContractSnapshot(
  repoRoot: string,
  snapshot: ContractSnapshot,
  liveLedger: unknown,
): SnapshotVerification {
  const errors: string[] = []
  if (snapshot?.version !== '1.0.0') return { passed: false, errors: ['invalid snapshot schema'] }
  const liveOwners = buildOwnerManifest(repoRoot)
  const liveSourcesHash = computeSourcesHash(liveOwners)
  const liveRulesDigest = computeRulesDigest(liveLedger)
  if (stableJson(snapshot.owners) !== stableJson(liveOwners))
    errors.push('owner path, role, or bytes changed')
  if (snapshot.sourcesHash !== liveSourcesHash) errors.push('sources hash is stale')
  if (snapshot.rulesDigest !== liveRulesDigest) errors.push('compiled rules digest changed')
  if (!snapshot.ledger || typeof snapshot.ledger !== 'object') {
    errors.push('embedded ledger is missing or malformed')
  } else {
    const embeddedLedger = snapshot.ledger as Record<string, unknown>
    if (embeddedLedger.sourcesHash !== snapshot.sourcesHash) {
      errors.push('embedded ledger sources hash does not match snapshot')
    }
    if (computeRulesDigest(snapshot.ledger) !== snapshot.rulesDigest) {
      errors.push('embedded ledger rules digest does not match snapshot')
    }
  }
  if (snapshot.contractHash !== sha256(`${snapshot.sourcesHash}\0${snapshot.rulesDigest}`)) {
    errors.push('contract hash is malformed')
  }
  const { snapshotHash: recordedHash, ...withoutHash } = snapshot
  if (recordedHash !== sha256(stableJson(snapshotPayload(withoutHash))))
    errors.push('snapshot hash is malformed')
  for (const owner of snapshot.owners) {
    if (!fs.existsSync(path.join(repoRoot, owner.path)))
      errors.push(`explicit owner file is missing: ${owner.path}`)
  }
  try {
    validateProposalApproval(
      repoRoot,
      snapshot.proposal,
      snapshot.approval,
      snapshot.approvedDirtyPaths,
    )
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { passed: errors.length === 0, errors }
}

export function buildTargetManifest(repoRoot: string, files: string[]): TargetManifestEntry[] {
  const root = path.resolve(repoRoot)
  return [...new Set(files.map((file) => path.resolve(file)))]
    .map((absolute) => {
      const relative = path.relative(root, absolute).replace(/\\/g, '/')
      if (relative === '' || relative.startsWith('../') || path.isAbsolute(relative)) {
        throw new Error(`target is outside repository: ${absolute}`)
      }
      if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
        throw new Error(`target is not a regular file: ${relative}`)
      }
      return { path: relative, contentHash: sha256(fs.readFileSync(absolute)) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function computeEvaluationHash(
  snapshotHash: string,
  contractHash: string,
  targets: TargetManifestEntry[],
  result: unknown,
): string {
  return sha256(stableJson({ snapshotHash, contractHash, targets, result }))
}
