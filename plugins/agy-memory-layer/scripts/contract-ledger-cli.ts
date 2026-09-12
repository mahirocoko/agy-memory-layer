import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  type CodeEvaluationResult,
  type ContractLedger,
  compileContractLedger,
  evaluateCodeAgainstContract,
  type RuleCoverage,
  verifyContractLedger,
} from './contract-ledger.ts'
import {
  buildTargetManifest,
  type ContractSnapshot,
  computeEvaluationHash,
  computeRulesDigest,
  createContractSnapshot,
  type RefineApproval,
  type RefineProposal,
  stableJson,
  verifyContractSnapshot,
} from './contract-snapshot.ts'

type EvaluationWorkflowBinding = {
  compliant: boolean
  snapshotHash: string
  contractHash: string
  targets: Array<{ path: string; contentHash: string }>
  evaluationHash: string
}

type BoundEvaluationResult = CodeEvaluationResult & { workflow: EvaluationWorkflowBinding }
type ReviewEvidence = { source: string; detail: string }
type HeuristicReview = {
  evaluationHash?: string
  assessedBy?: string
  reviews: Array<{
    ruleId: string
    ruleTitle?: string
    verdict: 'pass' | 'violation' | 'not-applicable' | 'cannot-assess'
    rationale?: string
    evidence?: ReviewEvidence[]
  }>
}

export function collectCodeFiles(targets: string[], repoRoot: string): string[] {
  const result: string[] = []
  const extensions = ['.ts', '.tsx', '.js', '.jsx']
  for (const target of targets) {
    const absolute = path.isAbsolute(target) ? target : path.resolve(repoRoot, target)
    if (!fs.existsSync(absolute)) continue
    const stat = fs.statSync(absolute)
    if (stat.isFile()) {
      if (extensions.some((extension) => absolute.endsWith(extension))) result.push(absolute)
    } else if (stat.isDirectory()) {
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue
          const full = path.join(directory, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.isFile() && extensions.some((extension) => full.endsWith(extension))) {
            result.push(full)
          }
        }
      }
      walk(absolute)
    }
  }
  return result
}

function assertTargetRootsContained(targets: string[], repoRoot: string): void {
  const realRoot = fs.realpathSync(repoRoot)
  for (const target of targets) {
    const absolute = path.isAbsolute(target) ? target : path.resolve(repoRoot, target)
    if (!fs.existsSync(absolute)) {
      throw new Error(`target does not exist: ${absolute}`)
    }
    const relative = path.relative(realRoot, fs.realpathSync(absolute)).replace(/\\/g, '/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error(`target is outside repository: ${absolute}`)
    }
  }
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index === -1 ? null : (args[index + 1] ?? null)
}

function readJsonFile<T>(workspaceDir: string, candidate: string, label: string): T {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceDir, candidate)
  if (!fs.existsSync(absolute)) throw new Error(`${label} file not found at ${absolute}`)
  return JSON.parse(fs.readFileSync(absolute, 'utf-8')) as T
}

function validateReviewEntry(review: HeuristicReview['reviews'][number]): string | null {
  if (!['pass', 'not-applicable', 'violation'].includes(review.verdict)) return null
  if (
    typeof review.rationale !== 'string' ||
    review.rationale.trim().length === 0 ||
    review.rationale.length > 2000
  ) {
    return `review ${review.ruleId} requires a non-empty rationale of at most 2000 characters`
  }
  if (
    !Array.isArray(review.evidence) ||
    review.evidence.length === 0 ||
    review.evidence.length > 20
  ) {
    return `review ${review.ruleId} requires 1-20 evidence entries`
  }
  for (const evidence of review.evidence) {
    if (
      !evidence ||
      typeof evidence.source !== 'string' ||
      evidence.source.trim().length === 0 ||
      evidence.source.length > 500 ||
      typeof evidence.detail !== 'string' ||
      evidence.detail.trim().length === 0 ||
      evidence.detail.length > 1000
    ) {
      return `review ${review.ruleId} contains malformed or unbounded evidence`
    }
  }
  return null
}

export function runCli(): void {
  const args = process.argv.slice(2)
  const command = args[0] || 'verify'
  const workspaceDir = process.cwd()

  if (command === 'compile') {
    const ledger = compileContractLedger(workspaceDir)
    const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : null
    if (outputPath) {
      fs.writeFileSync(
        path.resolve(workspaceDir, outputPath),
        JSON.stringify(ledger, null, 2),
        'utf-8',
      )
      console.log(`✓ Compiled contract ledger with ${ledger.rules.length} rules to ${outputPath}`)
    } else console.log(JSON.stringify(ledger, null, 2))
    process.exit(0)
  }

  if (command === 'verify') {
    const ledger = compileContractLedger(workspaceDir)
    const result = verifyContractLedger(ledger, workspaceDir)
    console.log(`📋 Contract Ledger Verification for: ${path.basename(workspaceDir)}`)
    console.log(
      `   Rules: ${result.totalRules} | Spokes: ${result.totalSpokes} | Hash: ${ledger.sourcesHash.slice(0, 8)}`,
    )
    if (result.passed && result.findings.length === 0) {
      console.log('✓ All hub-and-spoke links, paths, and rule definitions are clean!\n')
      process.exit(0)
    }
    if (result.findings.length > 0) {
      console.log(`\nFindings (${result.findings.length}):`)
      for (const finding of result.findings) {
        const icon =
          finding.severity === 'error' ? '❌' : finding.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(
          `  ${icon} [${finding.code}] ${finding.file}${finding.line ? `:${finding.line}` : ''}`,
        )
        console.log(`     ${finding.message}`)
        if (finding.suggestion) console.log(`     ↳ Suggestion: ${finding.suggestion}`)
      }
      console.log('')
    }
    process.exit(result.passed ? 0 : 1)
  }

  if (command === 'snapshot') {
    const outputPath = optionValue(args, '--output')
    const proposalPath = optionValue(args, '--proposal')
    const approvalPath = optionValue(args, '--approval')
    if (!outputPath || !proposalPath || !approvalPath) {
      console.error(
        'Usage: contract-ledger.ts snapshot --output <path> --proposal <path> --approval <path>',
      )
      process.exit(2)
    }
    try {
      const proposal = readJsonFile<RefineProposal>(workspaceDir, proposalPath, 'proposal')
      const approval = readJsonFile<RefineApproval>(workspaceDir, approvalPath, 'approval')
      const snapshot = createContractSnapshot(
        workspaceDir,
        compileContractLedger(workspaceDir),
        proposal,
        approval,
      )
      fs.writeFileSync(path.resolve(workspaceDir, outputPath), JSON.stringify(snapshot, null, 2))
      console.log(
        `Created contract snapshot ${snapshot.snapshotHash} (approval is recorded, not authenticated).`,
      )
      process.exit(0)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }
  }

  if (command === 'snapshot-verify') {
    const snapshotPath = optionValue(args, '--snapshot') ?? args[1]
    if (!snapshotPath || snapshotPath.startsWith('--')) {
      console.error('Usage: contract-ledger.ts snapshot-verify --snapshot <path>')
      process.exit(2)
    }
    try {
      const snapshot = readJsonFile<ContractSnapshot>(workspaceDir, snapshotPath, 'snapshot')
      const verification = verifyContractSnapshot(
        workspaceDir,
        snapshot,
        compileContractLedger(workspaceDir),
      )
      if (!verification.passed) {
        for (const error of verification.errors) console.error(`Error: ${error}`)
        process.exit(1)
      }
      console.log(`Verified contract snapshot ${snapshot.snapshotHash}.`)
      process.exit(0)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }
  }

  if (command === 'eval') {
    const ledgerPath = optionValue(args, '--ledger')
    const snapshotPath = optionValue(args, '--snapshot')
    const isJson = args.includes('--json')
    const isDeterministicOnly = args.includes('--deterministic-only')
    const unsafeLive = args.includes('--unsafe-live-contract')
    const optionsWithValues = new Set(['--ledger', '--snapshot'])
    const targetArgs: string[] = []
    for (let index = 1; index < args.length; index++) {
      const argument = args[index]
      if (optionsWithValues.has(argument)) index++
      else if (!argument.startsWith('--')) targetArgs.push(argument)
    }
    if (targetArgs.length === 0 || (!snapshotPath && !unsafeLive) || (snapshotPath && unsafeLive)) {
      console.error(
        'Usage: contract-ledger.ts eval --snapshot <path> [--ledger <path>] [--json] <files-or-dirs...>\n' +
          'Low-level only: --unsafe-live-contract is NON-COMPLIANT and cannot be combined with --snapshot.',
      )
      process.exit(2)
    }

    let ledger: ContractLedger
    let snapshot: ContractSnapshot | null = null
    try {
      const liveLedger = compileContractLedger(workspaceDir)
      if (snapshotPath) {
        snapshot = readJsonFile<ContractSnapshot>(workspaceDir, snapshotPath, 'snapshot')
        const verification = verifyContractSnapshot(workspaceDir, snapshot, liveLedger)
        if (!verification.passed) throw new Error(verification.errors.join('; '))
        ledger = snapshot.ledger as ContractLedger
      } else ledger = liveLedger
      if (ledgerPath) {
        const explicitLedger = readJsonFile<ContractLedger>(workspaceDir, ledgerPath, 'ledger')
        const expectedSourcesHash = snapshot?.sourcesHash ?? liveLedger.sourcesHash
        const expectedRulesDigest = snapshot?.rulesDigest ?? computeRulesDigest(liveLedger)
        if (
          explicitLedger.sourcesHash !== expectedSourcesHash ||
          computeRulesDigest(explicitLedger) !== expectedRulesDigest
        ) {
          throw new Error('explicit ledger is stale or does not match the active contract')
        }
        ledger = explicitLedger
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }

    try {
      assertTargetRootsContained(targetArgs, workspaceDir)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }
    const targetFiles = collectCodeFiles(targetArgs, workspaceDir)
    if (targetFiles.length === 0) {
      console.error(`Error: no regular code files resolved from targets: ${targetArgs.join(', ')}`)
      process.exit(2)
    }
    const result = evaluateCodeAgainstContract(ledger, targetFiles)
    let targets: ReturnType<typeof buildTargetManifest>
    try {
      targets = buildTargetManifest(workspaceDir, targetFiles)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }
    const snapshotHash = snapshot?.snapshotHash ?? 'unsafe-live-contract'
    const contractHash = snapshot?.contractHash ?? ledger.sourcesHash
    const workflowBase = { compliant: snapshot !== null, snapshotHash, contractHash, targets }
    const boundResult: BoundEvaluationResult = {
      ...result,
      workflow: {
        ...workflowBase,
        evaluationHash: computeEvaluationHash(snapshotHash, contractHash, targets, result),
      },
    }
    if (isJson) {
      console.log(JSON.stringify(boundResult, null, 2))
      if (result.verdict === 'deterministic-violations') process.exit(1)
      if (result.verdict === 'contract-dispute') process.exit(4)
      if (result.coverage.ratio === 1.0 || isDeterministicOnly) process.exit(0)
      process.exit(3)
    }

    if (unsafeLive)
      console.log('NON-COMPLIANT: evaluating an unsafe live contract for low-level/manual testing.')
    const totalActiveInScope = result.coverage.evaluated.length + result.coverage.unevaluated.length
    const coveragePct = Math.round(result.coverage.ratio * 100)
    const violationsCount = result.codeFindings.filter(
      (finding) => finding.severity === 'violation' && !finding.diffSuppressed,
    ).length
    const leadsCount = result.codeFindings.filter(
      (finding) => finding.severity === 'lead' && !finding.diffSuppressed,
    ).length
    const heuristicCount = result.coverage.unevaluated.filter(
      (rule) => rule.declaredClass === 'heuristic',
    ).length
    const humanCount = result.coverage.unevaluated.filter(
      (rule) => rule.declaredClass === 'human-only',
    ).length
    const declaredDetCount = result.coverage.unevaluated.filter(
      (rule) => rule.declaredClass === 'deterministic',
    ).length
    console.log(
      `🔍 Code Contract Evaluation: ${targetFiles.length} file(s) checked | ${totalActiveInScope} active rule(s) in scope`,
    )
    console.log(
      `   Deterministic: ${result.coverage.evaluated.length} rule(s) bound to evaluators — ${violationsCount} violation(s), ${leadsCount} lead(s)`,
    )
    console.log(
      `   Unevaluated:   ${result.coverage.unevaluated.length} rule(s) (${heuristicCount} heuristic, ${humanCount} human-only, ${declaredDetCount} declared-deterministic without evaluator)`,
    )
    console.log(
      `   Coverage:      ${coveragePct}% → deterministic pass is NOT a compliance verdict. Heuristic review REQUIRED.`,
    )
    if (result.contractFindings.length > 0) {
      console.log(`\n⚠️ Contract Status Findings (${result.contractFindings.length}):`)
      for (const finding of result.contractFindings) {
        console.log(`  - [${finding.ruleTitle}] ${finding.message}`)
        console.log(`    ↳ Action: ${finding.suggestedAction}`)
      }
    }
    if (result.codeFindings.length > 0) {
      console.log(`\nFindings (${result.codeFindings.length}):`)
      for (const finding of result.codeFindings) {
        const icon = finding.diffSuppressed ? '⚠️' : finding.severity === 'violation' ? '❌' : 'ℹ️'
        const tag = finding.diffSuppressed
          ? '[DISPUTED]'
          : finding.severity === 'violation'
            ? '[VIOLATION]'
            : '[LEAD]'
        console.log(`  ${icon} ${tag} ${finding.file}:${finding.line} [${finding.ruleTitle}]`)
        console.log(`     ${finding.message}`)
        if (finding.suggestedAction) console.log(`     ↳ ${finding.suggestedAction}`)
      }
    }
    if (result.verdict === 'deterministic-violations') {
      console.log(
        `\n❌ Deterministic violations found (${violationsCount} violation(s)). Fix code before proceeding.`,
      )
      process.exit(1)
    }
    if (result.verdict === 'contract-dispute') {
      console.log(
        '\n⚠️ Contract dispute detected. In reality this pattern is disputed; route to /contract-refine.',
      )
      process.exit(4)
    }
    if (result.coverage.ratio === 1.0 || isDeterministicOnly) {
      console.log(`\n✓ Deterministic rules evaluated cleanly (Coverage: ${coveragePct}%).`)
      process.exit(0)
    }
    console.log(
      `\nℹ️ Deterministic checks passed for evaluated rules, but ${result.coverage.unevaluated.length} unevaluated rule(s) require model heuristic review.`,
    )
    console.log(
      "   Run model review on unevaluated rules and verify with 'contract-ledger.ts verdict'.",
    )
    process.exit(3)
  }

  if (command === 'verdict') {
    const evalPath = optionValue(args, '--eval')
    const reviewPath = optionValue(args, '--review')
    const snapshotPath = optionValue(args, '--snapshot')
    if (!evalPath || !reviewPath || !snapshotPath) {
      console.error(
        'Usage: contract-ledger.ts verdict --snapshot <path> --eval <eval-result.json> --review <heuristic-review.json>',
      )
      process.exit(2)
    }
    let evalResult: BoundEvaluationResult
    let reviewData: HeuristicReview
    let snapshot: ContractSnapshot
    try {
      evalResult = readJsonFile<BoundEvaluationResult>(workspaceDir, evalPath, 'eval')
      reviewData = readJsonFile<HeuristicReview>(workspaceDir, reviewPath, 'review')
      snapshot = readJsonFile<ContractSnapshot>(workspaceDir, snapshotPath, 'snapshot')
      const verification = verifyContractSnapshot(
        workspaceDir,
        snapshot,
        compileContractLedger(workspaceDir),
      )
      if (!verification.passed) throw new Error(verification.errors.join('; '))
      if (!evalResult.workflow?.compliant) throw new Error('eval result is not snapshot-bound')
      if (
        evalResult.workflow.snapshotHash !== snapshot.snapshotHash ||
        evalResult.workflow.contractHash !== snapshot.contractHash
      ) {
        throw new Error('eval result is bound to a different snapshot or contract')
      }
      const currentTargets = buildTargetManifest(
        workspaceDir,
        evalResult.workflow.targets.map((target) => path.resolve(workspaceDir, target.path)),
      )
      if (stableJson(currentTargets) !== stableJson(evalResult.workflow.targets)) {
        throw new Error('target path or bytes changed after evaluation')
      }
      const { workflow, ...baseResult } = evalResult
      const expectedEvaluationHash = computeEvaluationHash(
        snapshot.snapshotHash,
        snapshot.contractHash,
        currentTargets,
        baseResult,
      )
      if (workflow.evaluationHash !== expectedEvaluationHash)
        throw new Error('evaluation hash is malformed')
      if (reviewData.evaluationHash !== expectedEvaluationHash) {
        throw new Error('review does not bind the exact evaluation hash')
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    }
    if (!reviewData || !Array.isArray(reviewData.reviews)) {
      console.error("Error: review file must contain a 'reviews' array.")
      process.exit(2)
    }
    if (evalResult.totalFilesChecked === 0) {
      console.error('Error: eval result checked 0 files; cannot grant ALIGNED.')
      process.exit(2)
    }
    const seenReviewRules = new Set<string>()
    for (const review of reviewData.reviews) {
      if (seenReviewRules.has(review.ruleId)) {
        console.error(
          `Error: duplicate review entry for rule ID '${review.ruleId}' detected in review file.`,
        )
        process.exit(2)
      }
      seenReviewRules.add(review.ruleId)
      const reviewError = validateReviewEntry(review)
      if (reviewError) {
        console.error(`Error: ${reviewError}`)
        process.exit(2)
      }
    }
    if (evalResult.verdict !== 'deterministic-clean') {
      console.log(
        `❌ Evaluation verdict is '${evalResult.verdict}'; cannot declare aligned until violations/disputes are resolved.`,
      )
      process.exit(evalResult.verdict === 'contract-dispute' ? 4 : 1)
    }
    const reviewsByRuleId = new Map(reviewData.reviews.map((review) => [review.ruleId, review]))
    const unassessed: RuleCoverage[] = []
    const heuristicViolations: string[] = []
    for (const unevaluated of evalResult.coverage.unevaluated) {
      const review = reviewsByRuleId.get(unevaluated.ruleId)
      if (
        !review ||
        review.verdict === 'cannot-assess' ||
        !['pass', 'not-applicable', 'violation'].includes(review.verdict)
      )
        unassessed.push(unevaluated)
      else if (review.verdict === 'violation') {
        heuristicViolations.push(
          `${unevaluated.title}: ${review.rationale || 'Violation reported'}`,
        )
      }
    }
    if (heuristicViolations.length > 0) {
      console.log(`\n❌ Heuristic review reported ${heuristicViolations.length} violation(s):`)
      for (const violation of heuristicViolations) console.log(`  - ${violation}`)
      process.exit(1)
    }
    if (unassessed.length > 0) {
      console.log(`\n⚠️ INCOMPLETE REVIEW: ${unassessed.length} rule(s) lack a definitive verdict:`)
      for (const rule of unassessed)
        console.log(`  - [${rule.ruleId}] ${rule.title} (${rule.owner})`)
      console.log('   Tool refuses to grant ALIGNED until all active rules are assessed.')
      process.exit(3)
    }
    const totalEvaluatedCount = evalResult.coverage.evaluated.length
    const totalHeuristicCount = evalResult.coverage.unevaluated.length
    console.log(
      `\n✓ VERDICT: ALIGNED (${totalEvaluatedCount + totalHeuristicCount} rules assessed: ${totalEvaluatedCount} deterministic, ${totalHeuristicCount} heuristic)`,
    )
    process.exit(0)
  }

  console.error(
    `Unknown command: ${command}. Use 'compile', 'verify', 'snapshot', 'snapshot-verify', 'eval', or 'verdict'.`,
  )
  process.exit(2)
}
