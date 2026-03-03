# GitHub Regression Fixtures with Missing Test File

## Fixture 1: charmbracelet/vhs

### Test Files
```bash
bun test tests/templates/nonexistent-test.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
```

### Package Scripts
```bash
bun run test:github:reported-failures
```
