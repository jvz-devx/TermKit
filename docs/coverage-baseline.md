# Coverage Baseline

Initial V7 coverage baseline captured with:

```sh
nix develop -c npm run test:coverage
```

Baseline from the integrated V7 foundation wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  60.44% |
| Branches   |  57.25% |
| Functions  |  58.77% |
| Lines      |  63.05% |

The current CI gate intentionally ratchets at or just below this baseline:

| Metric     | Gate |
| ---------- | ---: |
| Statements |  60% |
| Branches   |  55% |
| Functions  |  58% |
| Lines      |  63% |

V7 is not complete at this baseline. The remaining milestone target is to raise meaningful owned surfaces toward the thresholds in `spec.md`: server code first, then protocol and websocket-owned logic, then broader route and workflow coverage where tests catch real regressions.
