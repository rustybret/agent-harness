#!/usr/bin/env bash
# opencode-models-export.sh
# Pulls the opencode model list and reformats it into a proper JSON file.
# Usage: ./opencode-models-export.sh [output-dir]

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OUTPUT_DIR="${1:-$(dirname "$0")}"
DATE_ID=$(date +"%Y%m%d-%H%M%S")
TEMP_DIR="$(dirname "$0")/temp"
mkdir -p "$TEMP_DIR"
RAW_FILE="${TEMP_DIR}/models-verbose-${DATE_ID}.raw.txt"
OUT_FILE="${OUTPUT_DIR}/models-verbose.json"
SCHEMA="https://json-schema.org/draft-04/schema#"
SCHEMA_VERSION="2025.05.13"
KEEP_RAW_FILES=5

cleanup_interrupt() {
  echo "Interrupted. Temporary files preserved."
  exit 130
}
trap cleanup_interrupt INT TERM

if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "✗  Output directory does not exist: $OUTPUT_DIR" >&2
  exit 1
fi
if [[ ! -w "$OUTPUT_DIR" ]]; then
  echo "✗  Output directory is not writable: $OUTPUT_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Capture raw output
# ---------------------------------------------------------------------------
echo "→ Fetching model list from opencode..."
mkdir -p "$OUTPUT_DIR"

if ! command -v opencode &>/dev/null; then
  echo "✗  'opencode' command not found. Make sure it is installed and on your PATH." >&2
  exit 1
fi

opencode models --refresh --verbose > "$RAW_FILE"
echo "  Raw output saved to: $RAW_FILE"

# ---------------------------------------------------------------------------
# 2. Write Python parser to a temp file and execute it
# ---------------------------------------------------------------------------
echo "→ Reformatting to structured JSON..."

python3 -c "
import sys, json, re

raw_path = sys.argv[1]
out_path  = sys.argv[2]
schema    = sys.argv[3]
version   = sys.argv[4]

with open(raw_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find all key header positions using a pattern that matches 'provider/model-id' lines.
KEY_RE = re.compile(r'^([A-Za-z0-9_@.\-]+/[A-Za-z0-9_@.:\-/]+)\s*$', re.MULTILINE)
decoder = json.JSONDecoder()
models  = {}
errors  = 0

key_matches = list(KEY_RE.finditer(content))

for i, m in enumerate(key_matches):
    key         = m.group(1).strip()
    search_from = m.end()
    search_end  = key_matches[i + 1].start() if i + 1 < len(key_matches) else len(content)
    segment     = content[search_from:search_end]
    brace_pos   = segment.find('{')

    if brace_pos == -1:
        print(f'  warning: no JSON object found for: {key}', file=sys.stderr)
        errors += 1
        continue

    try:
        obj, _ = decoder.raw_decode(segment, brace_pos)
    except json.JSONDecodeError as e:
        print(f'  warning: parse error for {key}: {e}', file=sys.stderr)
        errors += 1
        continue

    models[key] = dict(sorted(obj.items()))

sorted_models = dict(sorted(models.items()))
output = {'\$schema': schema, 'version': version, 'models': sorted_models}

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f'  Parsed {len(sorted_models)} model(s)  ({errors} error(s)).')
" "$RAW_FILE" "$OUT_FILE" "$SCHEMA" "$SCHEMA_VERSION"

# ---------------------------------------------------------------------------
# 3. Validate the output is well-formed JSON
# ---------------------------------------------------------------------------
if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$OUT_FILE" 2>/dev/null; then
  echo "✓  Valid JSON written to: $OUT_FILE"

  OLD_OUT_FILE="${TEMP_DIR}/models-verbose.json.bak"
  if [[ -f "$OLD_OUT_FILE" ]]; then
    echo "→ Comparing with previous version..."
    CHANGES=$(jq -n --slurpfile a "$OLD_OUT_FILE" --slurpfile b "$OUT_FILE" '
      ($a[0].models | keys | sort) as $a_keys | ($b[0].models | keys | sort) as $b_keys |
      {
        added: ($b_keys - $a_keys | length),
        removed: ($a_keys - $b_keys | length)
      }
    ')
    ADDED=$(echo "$CHANGES" | jq '.added')
    REMOVED=$(echo "$CHANGES" | jq '.removed')
    if [[ "$ADDED" -gt 0 ]] || [[ "$REMOVED" -gt 0 ]]; then
      echo "  Models added: $ADDED, removed: $REMOVED"
    else
      echo "  No model list changes detected."
    fi
  fi
  cp "$OUT_FILE" "$OLD_OUT_FILE"

  MODELS_PLUS_VARIANTS="${OUTPUT_DIR}/models+variants.json"
  MODELS="${OUTPUT_DIR}/models.json"

  jq "{\"\$schema\": .\"\$schema\", \"version\": \"$SCHEMA_VERSION\", models: (.models | to_entries | map({key: .key, variants: (.value.variants | keys)}))}" "$OUT_FILE" > "$MODELS_PLUS_VARIANTS"
  jq "{\"\$schema\": .\"\$schema\", \"version\": \"$SCHEMA_VERSION\", models: (.models | to_entries | map({key: .key}) )}" "$OUT_FILE" > "$MODELS"

  ls -t "$TEMP_DIR"/models-verbose-*.raw.txt 2>/dev/null | tail -n +$((KEEP_RAW_FILES + 1)) | xargs -r rm -f 2>/dev/null || true

else
  echo "✗  Output file failed JSON validation — check $RAW_FILE for issues." >&2
  exit 1
fi

echo "Done."
