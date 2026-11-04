#!/bin/sh
# Instala Prompt Coach en Codex: la skill $coach y el hook que retiene prompts flojos.
# Uso, desde cualquier sitio: sh adapters/codex/install.sh   (CODEX_HOME por defecto: ~/.codex)
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CODEX=${CODEX_HOME:-$HOME/.codex}
CLI="node --experimental-strip-types --no-warnings \"$ROOT/cli/prompt-coach.mts\""
mkdir -p "$CODEX/skills/coach"
sed "s|@PROMPT_COACH_CLI@|$CLI|g" "$ROOT/adapters/codex/skills/coach/SKILL.md" > "$CODEX/skills/coach/SKILL.md"
echo "Skill \$coach installed in $CODEX/skills/coach"
node "$ROOT/adapters/codex/merge-hooks.mjs" "$CODEX/hooks.json" "$ROOT/cli/prompt-coach.mts"
echo "Open Codex and run /hooks to review and trust the new hook: Codex skips hooks until you trust them."
