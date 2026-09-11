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
PATH="${HOME}/bin:${PATH}"
export PATH

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

  # Keep the current environment intact until both decryption and conversion
  # succeed. pipefail observes SOPS failures, including partial output.
  ENV_TMP="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  trap 'rm -f -- "${ENV_TMP}"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  echo "Decrypting ${SOPS_FILE} -> ${ENV_FILE}..."
  sops --decrypt "${SOPS_FILE}" | python3 /dev/fd/3 3<<'PY' > "${ENV_TMP}"
import sys
import json
import re

key_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_scalar(raw: str) -> str:
    raw = raw.strip()
    if raw in {"", "null", "Null", "NULL", "~"}:
        return ""
    if raw.startswith("\""):
        try:
            return str(json.loads(raw))
        except json.JSONDecodeError:
            return raw.strip("\"")
    if raw.startswith("'") and raw.endswith("'"):
        return raw[1:-1].replace("''", "'")
    return raw


def encode_env(key: str, value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if key.endswith("_PRIVATE_KEY"):
        value = value.replace("\\\\n", "\n").replace("\\n", "\n")
    # Este .env e consumido pelo docker compose, que INTERPOLA os valores: um `$`
    # literal precisa virar `$$`, senao uma senha como `!@#$Mariana*` chega ao
    # container como `!@#*` (o compose le `$Mariana` como variavel vazia e avisa
    # "variable is not set"). O compose desfaz o `$$` ao injetar no container.
    value = value.replace("$", "$$")
    needs_quote = any(c in value for c in [" ", "\n", "\"", "#", ";", "|", "&", "(", ")", "!", "'"])
    if not needs_quote:
        return f"{key}={value}"
    escaped = value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
    return f"{key}=\"{escaped}\""


count = 0
with sys.stdin as stream:
    for line in stream:
        line = line.rstrip("\n")
        if not line or line.lstrip().startswith("#") or line.strip() == "---":
            continue
        if line.startswith((" ", "\t", "-")) or ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        if not key_re.match(key):
            continue
        print(encode_env(key, parse_scalar(val)))
        count += 1
if count == 0:
    raise SystemExit("Error: decrypted configuration contains no environment variables.")
PY

  chmod 600 "${ENV_TMP}"
  mv -f -- "${ENV_TMP}" "${ENV_FILE}"
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
