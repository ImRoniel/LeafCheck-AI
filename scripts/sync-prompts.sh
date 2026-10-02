#!/bin/bash
# Generates the Codex CLI and GitHub Copilot adapters from the canonical
# PINCER playbooks in .claude/commands/. The playbooks are the single source
# of truth: edit them, re-run this script, commit the result.
#
#   .agents/skills/pincer-*/SKILL.md    — Codex CLI skills (repo-local; Codex
#                                         removed custom prompts in 0.9x, see
#                                         openai/codex#16115). Invoke by typing
#                                         $pincer-plan <brief> in a Codex session.
#   .github/prompts/pincer-*.prompt.md  — VS Code Copilot prompt files
#                                         (enable: "chat.promptFiles": true)
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p .agents/skills .github/prompts

count=0
for src in .claude/commands/pincer-*.md; do
  name=$(basename "$src" .md)
  desc=$(sed -n 's/^description: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$src" | head -1)
  if grep -q '^argument-hint:.*optional' "$src"; then
    argument_text="the text that follows the \`\$$name\` mention, if any (when omitted, use the playbook's documented default)"
  else
    argument_text="the text that follows the \`\$$name\` mention in the user's message (ask only if the required input is missing)"
  fi
  body=$(awk 'flag; /^---$/ { if (++c == 2) flag = 1 }' "$src")

  # Codex: one skill directory per playbook. Skills have no $ARGUMENTS
  # substitution and are invoked as $name mentions, so the argument placeholder
  # becomes prose and cross-references to /pincer-* become $pincer-* (the
  # leading-context guard keeps paths like scripts/pincer-status.sh intact).
  mkdir -p ".agents/skills/$name"
  {
    printf -- '---\nname: %s\ndescription: "%s"\n---\n' "$name" "$desc"
    printf '<!-- Generated from %s by scripts/sync-prompts.sh — edit the source, not this file -->\n\n' "$src"
    printf '%s\n' "$body" \
      | sed "s/\$ARGUMENTS/$argument_text/g" \
      | sed -e 's#^/pincer-\([a-z]*\)#$pincer-\1#' -e 's#\([^A-Za-z0-9_./]\)/pincer-\([a-z]*\)#\1$pincer-\2#g'
  } > ".agents/skills/$name/SKILL.md"

  # Copilot: prompt-file frontmatter; $ARGUMENTS becomes an input variable.
  {
    printf -- '---\nmode: agent\ndescription: "%s"\n---\n' "$desc"
    printf '<!-- Generated from %s by scripts/sync-prompts.sh — edit the source, not this file -->\n\n' "$src"
    printf '%s\n' "$body" | sed 's/\$ARGUMENTS/${input:request:Task brief or arguments (optional)}/g'
  } > ".github/prompts/$name.prompt.md"

  count=$((count + 1))
done

echo "Synced $count playbooks -> .agents/skills/ and .github/prompts/"
