#!/usr/bin/env bash
# =============================================================================
# generate-env-from-vault.sh — Generate .env from SOPS or HashiCorp Vault
# =============================================================================
# Usage:
#   bash scripts/generate-env-from-vault.sh --sops   (recommended)
#   VAULT_TOKEN=hvs.xxx bash scripts/generate-env-from-vault.sh --vault
#
# Requirements:
#   SOPS mode:  sops CLI + age key at ~/.config/sops/age/keys.txt
#   Vault mode: vault-central Docker container
#
# Install SOPS: https://github.com/getsops/sops/releases
# Install age:  https://github.com/FiloSottile/age/releases
# =============================================================================
set -euo pipefail

MODE="${1:---sops}"
ENV_FILE=".env"

# ---------------------------------------------------------------------------
# SOPS mode (preferred)
# ---------------------------------------------------------------------------
if [[ "${MODE}" == "--sops" ]]; then
  SOPS_FILE=".env.sops.yaml"

  if [[ ! -f "${SOPS_FILE}" ]]; then
    echo "Error: ${SOPS_FILE} not found."
    echo "Create it from: cp .env.sops.yaml.example .env.sops.yaml"
    echo "Then fill in values and encrypt: sops --encrypt --in-place .env.sops.yaml"
    exit 1
  fi

  if ! command -v sops > /dev/null 2>&1; then
    echo "Error: sops CLI not found. Install: https://github.com/getsops/sops/releases"
    exit 1
  fi

  echo "Decrypting ${SOPS_FILE} -> ${ENV_FILE}..."
  sops --decrypt "${SOPS_FILE}" | python3 -c "
import sys

for line in sys.stdin:
    line = line.rstrip('\n')
    if not line or line.startswith('#'):
        continue
    if ': ' in line:
        key, _, val = line.partition(': ')
        key = key.strip()
        val = val.strip().strip('\"')
        needs_quote = any(c in val for c in [' ', chr(10), '\"', '#', ';', '|', '&'])
        if needs_quote:
            escaped = val.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"')
            print(f'{key}=\"{escaped}\"')
        else:
            print(f'{key}={val}')
" > "${ENV_FILE}"

  chmod 600 "${ENV_FILE}"
  echo "Done. ${ENV_FILE} generated from SOPS (chmod 600)."
  exit 0
fi

# ---------------------------------------------------------------------------
# Vault mode (legacy)
# ---------------------------------------------------------------------------
if [[ "${MODE}" == "--vault" ]]; then
  VAULT_CONTAINER="vault-central"
  VAULT_ADDR="http://127.0.0.1:8200"
  VAULT_TOKEN="${VAULT_TOKEN:-}"

  if [[ -z "${VAULT_TOKEN}" ]]; then
    echo "Error: VAULT_TOKEN required."
    echo "Usage: VAULT_TOKEN=hvs.xxx bash scripts/generate-env-from-vault.sh --vault"
    exit 1
  fi

  echo "Fetching importacao secrets from Vault..."

  RESPONSE="$(docker exec \
    -e VAULT_ADDR="${VAULT_ADDR}" \
    -e VAULT_TOKEN="${VAULT_TOKEN}" \
    "${VAULT_CONTAINER}" \
    vault kv get -format=json secret/importacao 2>&1)" || {
    echo "Error: Failed to fetch secrets from Vault"
    exit 1
  }

  echo "${RESPONSE}" | python3 -c "
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
  echo "Done. ${ENV_FILE} generated from Vault (chmod 600)."
  exit 0
fi

echo "Error: Unknown mode '${MODE}'. Use --sops or --vault."
exit 1
