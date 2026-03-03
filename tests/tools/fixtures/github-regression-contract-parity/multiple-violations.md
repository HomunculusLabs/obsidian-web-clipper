# GitHub Regression Fixtures with Multiple Violations

## Fixture 1: charmbracelet/vhs

### Test Files
```bash
bun test tests/templates/github-regression.test.ts
bun test tests/e2e/headless-clip-harness-regression.test.ts
bun test tests/templates/nonexistent.test.ts
```

### Package Scripts
```bash
bun run nonexistent:script
bun run another:missing:script
```

### Tool Paths
```bash
bun run tools/nonexistent-tool.ts
```
