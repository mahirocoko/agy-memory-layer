# Formatting & Markdown Standards — `agy-memory-layer`

This guide outlines code formatting, linting expectations, and Markdown presentation rules.

---

## 1. Markdown Standards

- **Semantic Hierarchy**: Always use a single `# H1` per document, followed by structured `## H2` and `### H3` sections.
- **GitHub Flavored Markdown**: Tables, bullet lists, checklist items (`- [ ]`), code fences with language tags (````javascript`, ````bash`).
- **Responsive Media & Diagram Tags**:
  Use centered HTML containers with `width="100%"` for diagrams to guarantee crisp rendering on GitHub and mobile displays:
  ```html
  <p align="center">
    <img src="./assets/subagents-architecture.jpg" width="100%" alt="Diagram Title" />
  </p>
  ```

---

## 2. JavaScript / Node.js Formatting

- 2-space indentation.
- Semicolons: Required (`semicolons: always`).
- Double quotes for JSON/Strings where standard, template literals (`` ` ``) for multiline string generation.
- Keep module functions cohesive and files below `1,000 lines`.
