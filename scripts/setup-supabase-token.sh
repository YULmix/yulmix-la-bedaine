#!/usr/bin/env bash
# (Re)creates the Supabase access token CI uses for one environment and stores it as a GitHub
# Environment secret. Supabase has no API to create a scoped access token (dashboard only), so the
# script prints what to tick, reads the pasted token from a hidden prompt, CHECKS it against the
# project (one cheap call per permission, so a missing one fails here and not in CI), and only then
# stores it with `gh secret set --env`. The token is never printed or put on a command line.
#
# The permissions live in scripts/supabase-ci-tokens.json, once. Needs: gh (logged in, admin on the
# repo), jq, curl.
#
# Usage: scripts/setup-supabase-token.sh <preview|production|all> [--dry-run]
#   --dry-run  print the plan (permissions, project, secret) and the checks; no prompt, no call.
# Env: SUPABASE_API_URL overrides the API base (tests only).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
conf="$here/supabase-ci-tokens.json"
target="${1:?usage: setup-supabase-token.sh <preview|production|all> [--dry-run]}"
dry=false
case "${2:-}" in --dry-run) dry=true ;; '') ;; *) echo "unknown option: $2" >&2; exit 2 ;; esac

if [ "$target" = all ]; then
  for e in production preview; do "$0" "$e" ${2:+"$2"}; done
  exit 0
fi
jq -e --arg e "$target" '.environments[$e]' "$conf" > /dev/null || { echo "unknown environment: $target" >&2; exit 2; }
field() { jq -r --arg e "$target" ".environments[\$e].$1" "$conf"; }
name=$(field projectName); ref=$(field projectRef); ghenv=$(field githubEnvironment); secret=$(field secret)
api="${SUPABASE_API_URL:-https://api.supabase.com}/v1/projects/$ref"

echo "== $target: project « $name » ($ref) → secret $secret in GitHub environment $ghenv"
echo "Create a SCOPED token at https://supabase.com/dashboard/account/tokens"
echo "  Resource access: Organization → YULmix (one org-scoped token, not per project). Everything not listed stays None:"
jq -r '.permissions[] | "    \(.[0]): \(.[1])"' "$conf"

# permission label | method path [body]: the cheapest call that needs it.
checks=(
  "Project Settings (read)|GET|"
  "API Keys / API Key Secrets|GET|/api-keys?reveal=true"
  "Auth Configuration (read)|GET|/config/auth"
  "Connection Pooling|GET|/config/database/pooler"
  "Migrations|GET|/database/migrations"
  "Edge Functions|GET|/functions"
  "Edge Function Secrets|GET|/secrets"
  "Database (read-write)|POST|/database/query"
)
if $dry; then
  echo "Then the script checks the token against $api:"
  for c in "${checks[@]}"; do IFS='|' read -r label method path <<<"$c"; echo "    $method ${path:-(project)}  ← $label"; done
  echo "    PATCH /config/auth with the current hook fields (a no-op)  ← Auth Configuration / Project Settings (write)"
  echo "(dry run: nothing asked, called or stored)"
  exit 0
fi

command -v gh > /dev/null && command -v jq > /dev/null || { echo "gh and jq are required" >&2; exit 1; }
read -rsp "Paste the token (hidden), then Enter: " token; echo
[ -n "$token" ] || { echo "No token given." >&2; exit 1; }
out=$(mktemp); trap 'rm -f "$out"' EXIT

# http <method> <path> [body] → status code; body left in $out. The token goes through a curl
# config on stdin, never argv.
http() {
  curl -sS -o "$out" -w '%{http_code}' -X "$1" "$api$2" -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
    -H 'Content-Type: application/json' ${3:+-d "$3"}
}
fail=0
for c in "${checks[@]}"; do
  IFS='|' read -r label method path <<<"$c"
  body=''; [ "$method" = POST ] && body='{"query":"select 1"}'
  s=$(http "$method" "$path" "$body") || s=000
  if [ "$s" -lt 300 ]; then echo "  ok      $label"; else echo "  MISSING $label (HTTP $s: $(jq -r '.message // empty' "$out" 2> /dev/null | head -c 200))"; fail=1; fi
done
# Write on the auth config: re-send the hook fields as they are. Needs auth_config_write (and
# project_admin_write, the 403 CI hit when the token only had Project Settings: Read).
if [ "$(http GET /config/auth)" -lt 300 ]; then
  patch=$(jq -c '{hook_custom_access_token_enabled: (.hook_custom_access_token_enabled // false)} + (if .hook_custom_access_token_uri then {hook_custom_access_token_uri} else {} end)' "$out")
  s=$(http PATCH /config/auth "$patch") || s=000
  if [ "$s" -lt 300 ]; then echo "  ok      Auth Configuration / Project Settings (write)"; else echo "  MISSING Auth Configuration / Project Settings (write) (HTTP $s: $(jq -r '.message // empty' "$out" 2> /dev/null | head -c 200))"; fail=1; fi
fi
if [ "$fail" != 0 ]; then
  echo "Token NOT stored: create a new one with every permission above (tokens can't be edited)." >&2
  exit 1
fi

printf %s "$token" | gh secret set "$secret" --env "$ghenv"
echo "Stored $secret in GitHub environment $ghenv."
echo "Re-run the failed CI job; the old token can be revoked on the dashboard page."
