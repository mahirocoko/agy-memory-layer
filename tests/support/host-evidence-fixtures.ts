import {
  computeManifestHash,
  deriveRetrievalAccounting,
  type FrozenContractBindings,
  type HostEvidence,
  type HostEvidenceManifest,
  sha256Text,
} from '../../tools/host-evidence-contract.ts'

export type HostEvidenceFixture = {
  manifest: HostEvidenceManifest
  evidence: HostEvidence
  bindings: FrozenContractBindings
}

export function synchronizeDerivedAccounting(fixture: HostEvidenceFixture): void {
  Object.assign(
    fixture.evidence.accounting,
    deriveRetrievalAccounting(fixture.manifest, fixture.evidence.retrievalResults),
  )
}

export function buildPositiveHostEvidenceFixture(): HostEvidenceFixture {
  const promptHash = sha256Text('synthetic host-evidence prompt v1')
  const answerKeyHash = sha256Text('synthetic answer key v1')
  const scorerHash = sha256Text('host-evidence scorer contract v1')
  const manifest: HostEvidenceManifest = {
    schemaVersion: 1,
    cellId: 'synthetic-cell-001',
    taskId: 'synthetic-task-001',
    promptHash,
    answerKeyHash,
    scorerHash,
    plannedHost: {
      agyVersion: 'agy-test-1.0.0',
      model: 'synthetic-model',
      effort: 'bounded',
    },
    executionPolicy: {
      allowMemoryMutation: false,
      allowLiveHostExecution: false,
      allowProviderAction: false,
    },
    expectedResponse: {
      status: 'ANSWERED',
      canonicalSource: 'reference/synthetic-runbook.md',
      fields: [
        { name: 'humanAction', value: 'throttle', unknownValue: 'UNKNOWN', policy: 'case-fold' },
        { name: 'api', value: 'POST', unknownValue: '', policy: 'exact' },
        { name: 'path', value: '/v1/synthetic/jobs', unknownValue: '', policy: 'exact' },
        { name: 'command', value: 'syntheticctl inspect', unknownValue: '', policy: 'exact' },
        { name: 'order', value: 'inspect then throttle', unknownValue: '', policy: 'exact' },
      ],
    },
    retrieval: {
      required: true,
      canonicalOwner: 'synthetic-runbook-owner',
      requiredFactMarkers: ['api-marker', 'command-marker', 'order-marker'],
      factAlreadyActive: false,
    },
    budgets: {
      gateEfficiency: false,
      maxTransportAttempts: 1,
      maxCreatedConversations: 1,
      maxPlannerResponses: 2,
      maxPlannerContinuations: 1,
      maxToolCalls: 2,
      maxSearchCalls: 1,
      maxReturnedBytes: 4096,
      maxNoProgressSteps: 0,
      maxRepeatedQueries: 0,
    },
  }
  const manifestHash = computeManifestHash(manifest)
  const evidence: HostEvidence = {
    schemaVersion: 1,
    cellId: manifest.cellId,
    manifestHash,
    promptHash,
    actualHost: { ...manifest.plannedHost },
    finalResponse: {
      taskId: manifest.taskId,
      status: 'ANSWERED',
      answer: {
        humanAction: 'Throttle',
        api: 'POST',
        path: '/v1/synthetic/jobs',
        command: 'syntheticctl inspect',
        order: 'inspect then throttle',
      },
      sources: [manifest.expectedResponse.canonicalSource],
    },
    terminal: {
      isTerminal: true,
      finalResponseSequence: 30,
      finalResponseCount: 1,
      intermediateCompletionCount: 0,
    },
    userInput: {
      structured: true,
      taskId: manifest.taskId,
    },
    protocolFacts: {
      memoryMutationObserved: false,
      liveHostExecutionObserved: false,
      providerActionObserved: false,
    },
    accounting: {
      transportAttempts: 1,
      createdConversations: 1,
      scoredUserInputs: 1,
      plannerResponses: 1,
      plannerContinuations: 0,
      toolCalls: 1,
      searchCalls: 0,
      providerRequests: 'unavailable',
      returnedBytes: 0,
      noProgressSteps: 0,
      repeatedQueries: 0,
    },
    transcript: {
      truncated: false,
      truncatedFields: [],
      providerInputBytes: 'unavailable',
    },
    retrievalResults: [
      {
        sequence: 20,
        query: 'synthetic runbook owner',
        owner: manifest.retrieval.canonicalOwner,
        source: manifest.expectedResponse.canonicalSource,
        success: true,
        content: 'api-marker command-marker order-marker',
      },
    ],
  }
  const fixture = {
    manifest,
    evidence,
    bindings: { manifestHash, promptHash, answerKeyHash, scorerHash },
  }
  synchronizeDerivedAccounting(fixture)
  return fixture
}

export function buildStoredLiveHostEvidenceFixture(): HostEvidenceFixture {
  const fixture = buildPositiveHostEvidenceFixture()
  fixture.manifest.executionPolicy.allowLiveHostExecution = true
  fixture.manifest.executionPolicy.allowProviderAction = true
  fixture.evidence.protocolFacts.liveHostExecutionObserved = true
  fixture.evidence.protocolFacts.providerActionObserved = true
  fixture.bindings.manifestHash = computeManifestHash(fixture.manifest)
  fixture.evidence.manifestHash = fixture.bindings.manifestHash
  return fixture
}

export function cloneHostEvidenceFixture(fixture: HostEvidenceFixture): HostEvidenceFixture {
  return structuredClone(fixture)
}
