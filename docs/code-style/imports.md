# Imports & Module Resolution — `agy-memory-layer`

This guide defines the import and module resolution conventions for this repository.

---

## 1. Native ESM and Node.js Built-ins

- This project runs on Node.js v22+ as native ESM (`"type": "module"`) and executes TypeScript with `--experimental-strip-types`.
- Use ESM imports with the `node:` prefix for built-ins:
  ```typescript
  import { execSync } from 'node:child_process'
  import * as fs from 'node:fs'
  import * as path from 'node:path'
  ```

---

## 2. Dynamic Plugin Script Resolution

- Scripts located in `plugins/agy-memory-layer/scripts/` must resolve paths relative to `import.meta.dirname` / `import.meta.filename` or environment variables:
  ```typescript
  const memoryRoot =
    process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
  const scriptsDir = import.meta.dirname
  ```
- Avoid hardcoded absolute user home paths in distributed plugin code; always resolve via `process.env.HOME` or `os.homedir()`.
