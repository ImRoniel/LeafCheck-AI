T-05 regression: node --test --test-name-pattern="^changes mode: valid" scripts/tests/pincer-freshness.test.mjs
Before the status.cjs change: one test failed because Notes reported stale candidate changed after evaluation: .prd/evidence/changes/fixture.json; the same report had current Evaluation, Evidence ok and a clean Git tree. This was a real assertion failure after rerunning outside sandbox; the initial sandbox child-runner failure is not behavioral evidence.
After the mode-aware locator.followers change: all three changes-mode focused tests passed, including additional valid-locator and dirty-Notes clean-tree cases.
Fixtures are synthetic disposable repositories and use fresh-clone saved-evidence readiness, not retained local attempts.
