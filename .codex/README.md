# PINCER on Codex CLI

Codex reads `AGENTS.md` at the repo root natively — the project rules apply
with no setup. The workflow commands ship as **skills** in `.agents/skills/`,
which Codex discovers from the repo on its own (Codex removed custom prompts
and `~/.codex/prompts/` in early 2026 — openai/codex#16115 — so there is
nothing to copy into your home directory).

Skills are invoked by mention: type `$` and pick from the list, or write the
name directly:

```
$pincer-plan <brief>
$pincer-narrow   →   $pincer-code   →   $pincer-evaluate   →   $pincer-release
$pincer-status
```

The skills point at the canonical playbooks, the two subagent rubrics and the
PRD/ticket templates under `.claude/` — those ship on every platform, so the
directory is expected here even without Claude Code.

`/skills` lists what Codex has loaded — the six `pincer-*` entries should be
there whenever you start `codex` inside this repo. The skills are generated
from `.claude/commands/` by `scripts/sync-prompts.sh` (cross-references are
rewritten from `/pincer-*` to `$pincer-*`, and the argument placeholder becomes
"the text after the mention") — edit the source playbooks, re-run the script,
commit the result.

## Recommended posture (`~/.codex/config.toml`)

This kit does not currently install a Codex hook adapter. Use Codex's sandbox,
approval policy, and project instructions as the guardrail posture:

```toml
approval_policy = "on-request"     # agent asks before escalating
sandbox_mode   = "workspace-write" # writes confined to the repo; no network by default
```

The ticket scripts work here unchanged (`scripts/pincer-ticket.sh
start|verify|done T-NN` and `scripts/pincer-status.sh`); they are thin wrappers
around `scripts/pincer-runtime.cjs`, so Node.js 22+ is required.
Without a Pincer Codex hook adapter, the rule in `AGENTS.md` carries the weight
of stopping hand-edited ticket state; `$pincer-status` warns about any ticket
marked done without a receipt.

Never run with approvals disabled. The destructive-command rule in `AGENTS.md`
(no force-pushes, absolute-path deletes, or `curl | sh` by an agent) applies as
a standing instruction here; `$pincer-release` audits the git artifacts
afterwards, which is platform-independent by design.
