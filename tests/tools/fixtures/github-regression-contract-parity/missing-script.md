# GitHub Regression Fixtures with Missing Script

## Fixture 1: charmbracelet/vhs

### Test Files
```bash
bun test tests/templates/github.test.ts
```

### Package Scripts
```bash
bun run test:github:reported-failures
bun run nonexistent:script
```
