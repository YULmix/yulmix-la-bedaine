#!/usr/bin/env bash
# Enables the custom access token hook (« Voir comme », ADR 0025) on a Supabase project through
# the Management API, then reads the setting back. Idempotent. CI runs it after the project's
# database has public.custom_access_token_hook: enabled without the function, every sign-in
# fails with "Error running hook URI".
#
# Usage: SUPABASE_ACCESS_TOKEN=... scripts/enable-access-token-hook.sh <project-ref>
# The token needs "Auth Configuration: Read-write" (auth_config_write).
set -euo pipefail

ref="${1:?usage: enable-access-token-hook.sh <project-ref>}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
uri='pg-functions://postgres/public/custom_access_token_hook'
url="https://api.supabase.com/v1/projects/$ref/config/auth"
out=$(mktemp)

status=$(curl -sS -o "$out" -w '%{http_code}' -X PATCH "$url" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"hook_custom_access_token_enabled\":true,\"hook_custom_access_token_uri\":\"$uri\"}")
if [ "$status" -ge 300 ]; then
  echo "::error::Enabling the hook on $ref failed (HTTP $status). The token needs Auth Configuration: Read-write."
  cat "$out"
  exit 1
fi

curl -fsS "$url" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | jq -e --arg uri "$uri" '.hook_custom_access_token_enabled == true and .hook_custom_access_token_uri == $uri' > /dev/null \
  || { echo "::error::The hook is not enabled on $ref after the update."; exit 1; }
echo "Custom access token hook enabled on $ref."
