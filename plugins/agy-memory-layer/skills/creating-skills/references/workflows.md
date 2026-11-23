# Workflow Patterns

## Sequential Workflows

Break multi-step processes into clear sequential steps at the top of `SKILL.md`:

```markdown
1. Inspect current state
2. Prepare exact edits
3. Apply via bounded tool or script
4. Verify result before reporting
```

## Conditional Workflows

For tasks with branching logic, guide the agent through explicit decision points:

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow Creation workflow
   **Editing existing content?** → Follow Editing workflow
```
