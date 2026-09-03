#!/usr/bin/env bash
# Restore gitignored local test files from a historical commit. Do not commit *.test.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEFAULT_COMMIT="0ca23c0"
COMMIT="${1:-$DEFAULT_COMMIT}"

FILES=(
  src/main/agent/command-classify.test.ts
  src/main/agent/generate-capture.test.ts
  src/main/agent/generate-sop.test.ts
  src/main/agent/model-provider-config.test.ts
  src/main/agent/pi-model-runtime.test.ts
  src/main/agent/skills.test.ts
  src/main/agent/transcription-support.test.ts
  src/main/crescent-store.test.ts
  src/renderer/src/lib/capture-draft-ui.test.ts
  src/renderer/src/lib/composer-ref-tokens.test.ts
  src/renderer/src/lib/connection-name-conflict.test.ts
  src/renderer/src/lib/ime-safe-value.test.ts
  src/renderer/src/lib/login-action-wait.test.ts
  src/renderer/src/lib/markdown-fence.test.ts
  src/renderer/src/lib/openapi-settings-profiles.test.ts
  src/renderer/src/lib/prompt-host-wait.test.ts
  src/renderer/src/lib/skill-markdown.test.ts
  src/renderer/src/lib/slash-commands.test.ts
  src/renderer/src/lib/terminal-ready-gate.test.ts
  src/shared/agent-prompt-discipline.test.ts
  src/shared/capture-intent.test.ts
  src/shared/openapi-profiles.test.ts
)

PRIORITY_COMMIT="43c4ef8"
PRIORITY_FILES=(
  src/shared/command-guard.test.ts
  src/shared/secret-redaction.test.ts
)

if ! git rev-parse --verify "$COMMIT^{commit}" >/dev/null 2>&1; then
  echo "Commit not found: $COMMIT" >&2
  exit 1
fi

restore_one() {
  local rev="$1"
  local path="$2"
  if ! git cat-file -e "$rev:$path" 2>/dev/null; then
    echo "skip (missing at $rev): $path"
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  git show "$rev:$path" >"$path"
  echo "restored: $path (from $rev)"
}

for path in "${FILES[@]}"; do
  restore_one "$COMMIT" "$path"
done

for path in "${PRIORITY_FILES[@]}"; do
  restore_one "$PRIORITY_COMMIT" "$path"
done

echo ""
echo "Done. Files are gitignored — run: npm run test:local"
