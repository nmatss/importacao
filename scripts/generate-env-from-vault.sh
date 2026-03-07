#!/bin/bash
# Generate .env from HashiCorp Vault for importacao project
#
# Usage:
#   cd ~/importacao && bash scripts/generate-env-from-vault.sh
#
# Requires: vault-central Docker container running on the same host.
# Vault token is read via docker exec (no token stored on disk).

set -euo pipefail

VAULT_CONTAINER="vault-central"
VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="${VAULT_TOKEN:-}"
ENV_FILE=".env"

if [ -z "$VAULT_TOKEN" ]; then
  echo "Error: VAULT_TOKEN required."
  echo "Usage: VAULT_TOKEN=hvs.xxx bash scripts/generate-env-from-vault.sh"
  exit 1
fi

echo "Fetching importacao secrets from Vault..."

# Fetch secrets via docker exec into vault container
RESPONSE=$(docker exec \
  -e VAULT_ADDR="${VAULT_ADDR}" \
  -e VAULT_TOKEN="${VAULT_TOKEN}" \
  "${VAULT_CONTAINER}" \
  vault kv get -format=json secret/importacao 2>&1) || {
  echo "Error: Failed to fetch secrets from Vault"
  exit 1
}

# Parse JSON and generate properly-quoted .env file
echo "$RESPONSE" | python3 -c "
import sys, json

data = json.load(sys.stdin)
secrets = data['data']['data']

needs_quote = lambda v: any(c in str(v) for c in [' ', '<', '>', chr(10), '\"', '#', ';', '|', '&', '(', ')', '!', \"'\"])

with open('${ENV_FILE}', 'w') as f:
    for key in sorted(secrets.keys()):
        value = str(secrets[key])
        if needs_quote(value):
            escaped = value.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"')
            f.write(f'{key}=\"{escaped}\"' + chr(10))
        else:
            f.write(f'{key}={value}' + chr(10))

print(f'Generated ${ENV_FILE} with {len(secrets)} variables')
"

chmod 600 "${ENV_FILE}"
echo "Done. .env generated and secured (chmod 600)."
