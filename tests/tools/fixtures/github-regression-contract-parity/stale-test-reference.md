# GitHub Regression Fixtures with Stale Test Reference

## Fixture 1: charmbracelet/vhs

### Test Files
```bash
bun test tests/templates/github-regression.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
```

### Package Scripts
```bash
bun run test:github:reported-failures
```
