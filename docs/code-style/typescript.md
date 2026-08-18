# TypeScript Code Style — `agy-memory-layer`

This guide specifies TypeScript standards and type safety rules for all code in this repository.

---

## 🚫 The Type Alias Mandate (No `interface`)

In this codebase, **always use `type` aliases**. Using `interface` is **strictly forbidden**.

```typescript
// ✅ CORRECT: Type alias
export type SubagentManifest = {
  name: string;
  description: string;
  role: string;
  modelTier: "inherit" | "flash" | "pro";
  enableWriteTools: boolean;
  systemPromptPath: string;
};

// ❌ FORBIDDEN: Interface
export interface SubagentManifest {
  name: string;
}
```

### Rationale:
1. Consistent semantic style across all modules.
2. Direct composition with union types, intersections, and mapped types without unexpected declaration merging.

---

## 🛡️ Error Boundaries & Type Narrowing

- Always check return values before accessing nested properties.
- Use explicit type narrowing with discriminated unions or type guards (`typeof`, `Array.isArray`, `in`).
- Handle filesystem and subprocess exceptions gracefully with `try/catch` and safe fallbacks.
