#!/usr/bin/env bash
# Enables the custom access token hook (« Voir comme », ADR 0025) on a Supabase project through
# the Management API, then reads the setting back. Idempotent: CI runs it on every push to main.
# It touches only the two hook fields of the project's auth config, and refuses to run when
# public.custom_access_token_hook is missing from the project's database (enabled without the
# function, every sign-in fails with "Error running hook URI").
#
# Usage: SUPABASE_ACCESS_TOKEN=... scripts/enable-access-token-hook.sh <project-ref> [--disable]
# The token needs "Auth Configuration: Read-write" and "Database: Read-write".
#
# --disable is the emergency rollback (docs/07-development-setup.md): it refuses while a
# « Voir comme » session is live, because the hook is what keeps that session read-only.
set -euo pipefail

ref="${1:?usage: enable-access-token-hook.sh <project-ref> [--disable]}"
mode="${2:-enable}"
case "$mode" in enable | --disable) ;; *) echo "unknown option: $mode" >&2; exit 2 ;; esac
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"

uri='pg-functions://postgres/public/custom_access_token_hook'
api="${SUPABASE_API_URL:-https://api.supabase.com}/v1/projects/$ref"  # override: tests only
out=$(mktemp)
trap 'rm -f "$out"' EXIT

# Calls the Management API; on an HTTP error prints a capped, never-secret-bearing excerpt.
call() { # method path [json body]
  local status
  status=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" "$api$2" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
    ${3:+-d "$3"}) || { echo "::error::$1 $2 on $ref: the request failed."; exit 1; }
  if [ "$status" -ge 300 ]; then
    echo "::error::$1 $2 on $ref failed (HTTP $status). Check the token's permissions (see the header of this script)."
    head -c 500 "$out"; echo
    exit 1
  fi
}

# Runs one SQL query through the Management API; the result rows (JSON) are left in $out.
sql() { call POST /database/query "$(jq -cn --arg q "$1" '{query: $q}')"; }

if [ "$mode" = "--disable" ]; then
  sql "select count(*) as live from public.impersonation_log where ended_at is null and expires_at > now()"
  live=$(jq -r '.[0].live' "$out")
  if [ "$live" != "0" ]; then
    echo "::error::$live « Voir comme » session(s) are live on $ref: disabling the hook would let them write. Wait for them to end."
    exit 1
  fi
  call PATCH /config/auth '{"hook_custom_access_token_enabled":false}'
  echo "Custom access token hook DISABLED on $ref."
  exit 0
fi

sql "select to_regprocedure('public.custom_access_token_hook(jsonb)') is not null as present"
if [ "$(jq -r '.[0].present' "$out")" != "true" ]; then
  echo "::error::public.custom_access_token_hook does not exist in $ref's database: not enabling the hook. Apply the migrations first."
  exit 1
fi

call PATCH /config/auth "$(jq -cn --arg uri "$uri" '{hook_custom_access_token_enabled: true, hook_custom_access_token_uri: $uri}')"

call GET /config/auth
jq -e --arg uri "$uri" '.hook_custom_access_token_enabled == true and .hook_custom_access_token_uri == $uri' "$out" > /dev/null \
  || { echo "::error::The hook is not enabled on $ref after the update."; exit 1; }
echo "Custom access token hook enabled on $ref."
