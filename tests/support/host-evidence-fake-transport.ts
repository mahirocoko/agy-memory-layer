import type { Receipt, ReceiptPayload } from '../../tools/host-evidence-receipts.ts'
import type { DispatchTransport } from '../../tools/host-evidence-store.ts'

export type FakeTransport = DispatchTransport & {
  readonly audit: {
    dispatches: number
    childProcesses: 0
    networkCalls: 0
    providerCalls: 0
    trustAutomationCalls: 0
    memfsPaths: 0
  }
}

export function createHostEvidenceFakeTransport(
  script: (
    receipt: Receipt,
    dispatchNumber: number,
  ) => ReceiptPayload | readonly ReceiptPayload[] | undefined,
): FakeTransport {
  const audit = {
    dispatches: 0,
    childProcesses: 0 as const,
    networkCalls: 0 as const,
    providerCalls: 0 as const,
    trustAutomationCalls: 0 as const,
    memfsPaths: 0 as const,
  }
  const transport = ((receipt: Receipt) => {
    audit.dispatches += 1
    return script(receipt, audit.dispatches)
  }) as FakeTransport
  Object.defineProperty(transport, 'audit', { value: audit, enumerable: true })
  return transport
}

export function throwingFakeTransport(message = 'injected offline interruption'): FakeTransport {
  return createHostEvidenceFakeTransport(() => {
    throw new Error(message)
  })
}
