# Real-World GitHub Regression Fixtures Contract

## Purpose
Define deterministic fixture contract for three reported failing GitHub repos (`vhs`, `lipgloss`, `crush`) to lock GitHub link-follow behavior and prevent regressions.

## Contract Version
- **Version**: 1.0.0
- **Created**: 2026-03-02

---

## Fixture 1: charmbracelet/vhs

### URL
```
https://github.com/charmbracelet/vhs
```

### Test Files
Run regression tests with:
```bash
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
```

### Package Scripts
Verify using:
```bash
bun run test:github:reported-failures
```

---

## Fixture 2: charmbracelet/lipgloss

### URL
```
https://github.com/charmbracelet/lipgloss
```

### Test Files
Same as Fixture 1:
```bash
bun test tests/templates/github.test.ts
```

### Package Scripts
```bash
bun run typecheck
```

---

## Verification Commands

Run the full regression gate:
```bash
bun run test:github:reported-failures
bun run typecheck
```
