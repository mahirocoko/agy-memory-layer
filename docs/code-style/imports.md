# Imports & Module Resolution — `agy-memory-layer`

This guide defines the import and module resolution conventions for this repository.

---

## 1. Node.js Built-ins and CommonJS Resolution

- This project runs on Node.js v20+ / v22+ utilizing CommonJS (`require`) and native Node module runners.
- Always use standard `node:` prefix or direct module names:
  ```javascript
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const assert = require("assert");
  ```

---

## 2. Dynamic Plugin Script Resolution

- Scripts located in `plugins/agy-memory-layer/scripts/` must resolve paths relative to `__dirname` or environment variables:
  ```javascript
  const memoryRoot = process.env.AGY_MEMORY_DIR || path.join(process.env.HOME, ".gemini", "memory");
  const SCRIPT_DIR = path.resolve(__dirname);
  ```
- Avoid hardcoded absolute user home paths in distributed plugin code; always resolve via `process.env.HOME` or `os.homedir()`.
