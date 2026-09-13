# Phase 4B isolated canary evidence

This fixture preserves the bounded, non-secret inputs and the exact Agy review packet from the
2026-09-13 `gemini-3.8-flash-high` canary. Run the verifier from this directory; exit `1` is the
expected result because the seeded release-state contradiction was disproved. The second claim is
`blocked` because the reviewer could not observe the host permission UI, while Main observed the
exact `force_ask` prompt in the receipt-bound pane.

```bash
node --experimental-strip-types ../../../plugins/agy-memory-layer/scripts/material-claim-review.ts verify --subject subject.json --review review.json
```

Raw pane/transcript and unredacted hook diagnostics were retained outside Git for the session. The
committed receipt records their hashes and bounded fields only. This evidence does not authenticate
reviewer identity, prove semantic correctness generally, or turn the plugin into a permission or
lifecycle supervisor.
