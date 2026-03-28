#!/bin/bash
# PostToolUse hook: lint files after Edit/Write
# Receives JSON on stdin with tool_input.file_path

FILE_PATH=$(jq -r '.tool_input.file_path // empty' < /dev/stdin)

# Only lint .ts files in src/ or tests/
if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" == *.ts ]]; then
  exit 0
fi

# Run ESLint on the edited file
npx eslint --no-error-on-unmatched-pattern "$FILE_PATH" 2>&1
