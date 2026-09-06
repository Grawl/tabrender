#!/bin/sh
# Redeploy an existing Portainer standalone stack with its current compose file, re-pulling images.
# The compose file itself is server configuration and lives only in Portainer (see README).
# Usage: portainer-redeploy.sh <stack-name>
# Env: PORTAINER_URL, PORTAINER_TOKEN, PORTAINER_ENDPOINT_ID
set -eu
name="$1"
api="$PORTAINER_URL/api"
auth="X-API-Key: $PORTAINER_TOKEN"

stack=$(curl -sS -H "$auth" "$api/stacks" | jq -c --arg n "$name" '.[] | select(.Name == $n)' | head -n1)
[ -n "$stack" ] || { echo "Stack $name does not exist in Portainer; create it once by hand from the server compose file"; exit 1; }
id=$(printf '%s' "$stack" | jq -r .Id)
env=$(printf '%s' "$stack" | jq -c '.Env // []')
content=$(curl -sS -H "$auth" "$api/stacks/$id/file" | jq -r .StackFileContent)

echo "Redeploying stack $name (id $id) with re-pulled images"
body=$(jq -n --arg c "$content" --argjson e "$env" '{stackFileContent: $c, env: $e, prune: true, pullImage: true}')
out=$(curl -sS -H "$auth" -H "Content-Type: application/json" -X PUT "$api/stacks/$id?endpointId=$PORTAINER_ENDPOINT_ID" --data "$body")
printf '%s' "$out" | jq -e '.Id' >/dev/null || { echo "Portainer error: $out"; exit 1; }
printf '%s' "$out" | jq '{Id, Name, Status}'
