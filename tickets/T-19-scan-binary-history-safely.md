---
ticket: T-19
status: done
size: S
prd: .prd/prd-v4.md
depends_on: []
timeout: 600
started: 2026-10-07T14:59:38Z
finished: 2026-10-07T15:01:18Z
---

## Objective
Prevent the required redacting history scan from crashing on binary evaluation artifacts.

## Context
C-08 failed with UnicodeDecodeError on prior PNG evidence. Credential patterns are ASCII; decoding Git blobs with Latin-1 maps every byte without dropping candidate data or skipping binary files.

## Requirements
- Decode Git blob output byte-preservingly in C-08, keeping all credential patterns and the base-to-HEAD history range.
- Confirm the declared scan succeeds over actual history containing PNGs and ASCII credential patterns remain detectable in arbitrary binary bytes.

## Acceptance Criteria
- [x] C-08 runs over actual history without a decoding failure.
- [x] Binary decoding preserves ASCII credential pattern detection without printing values.

## Verification
Proves: The actual declared history scan and binary ASCII detection remain operational.
```bash
set -euo pipefail
python3 - <<'PYTEST'
import json,subprocess,re
from pathlib import Path
command=json.loads(Path('.prd/coverage/prd-v4.json').read_text())['checks']['C-08']['command']
subprocess.run(['bash','-c',command],check=True)
blob=b'\x89PNG\xff'+b'AKIA'+b'A'*16
assert re.search(r'AKIA[0-9A-Z]{16}',blob.decode('latin-1'))
print('Binary decoding preserves ASCII credential detection; fixture values withheld')
PYTEST
```

## Constraints
Retain redaction, scope and native deferrals; no secrets, dependency upgrades or publishing.
