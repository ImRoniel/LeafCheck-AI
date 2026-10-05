# Pairing concurrency review

Candidate: 0285ee70aaab6de2cf8d9dbe60998bc4dbb627bf
C-07 result: passed.

Installed Prisma 6 generated client exposes isolationLevel Serializable for interactive $transaction and a TransactionClient type. Source reads ownership through tx, clears other holders through a predicate write, then assigns the target in the same transaction. The P2034 catch retries the entire unit at most three times, repeating ownership checks; exhaustion returns PAIRING_CONFLICT. No new SQL, dependencies or migration is used.

On this candidate, `node backend/scripts/test-plant-pairing.mjs` exited 0 using a disposable localhost PostgreSQL 16 Docker container. Three real database tests passed: overlapping assignments to distinct targets caused at least one actual serialization retry and retained one holder; injected target assignment failure rolled back previous auto-unpair; foreign ownership rejection preserved associations and repeat unpair succeeded. The generated container was removed by the ownership-checked cleanup. Tests touch no application database.

The guarantee is for this endpoint under Serializable transactions. Plant.deviceId has no global unique constraint; unrelated existing writers are outside this PRD's scope. MongoDB BFF mapping is mocked rather than tested against a live Atlas deployment.
