# Secrets Management

## Overview

Secrets are managed via SOPS + age (preferred) or HashiCorp Vault (legacy).

| Method     | Tool needed                           |
| ---------- | ------------------------------------- |
| SOPS + age | `sops`, `age`                         |
| Vault      | `vault` CLI + vault-central container |

## SOPS + age Setup

### Production Status

- Producao (`n8n`, `192.168.168.124`) esta configurada com SOPS + age.
- Chave privada age fica apenas no servidor em
  `~/.config/sops/age/keys.txt`.
- Chave publica versionada em `.sops.yaml`:
  `age1zm450szqdhnxsgcdtz4vn7fl60kt3lcgzjfaaasrvzghcw7rmu7s5xnsfr`.
- `.env.sops.yaml` e criptografado e versionado; o deploy gera `.env` remoto a
  partir dele e preserva o `.env` existente apenas como fallback de emergencia.

### Install

```bash
# age
wget https://github.com/FiloSottile/age/releases/latest/download/age-linux-amd64.tar.gz
tar -xzf age-linux-amd64.tar.gz && sudo mv age/age* /usr/local/bin/

# SOPS
wget https://github.com/getsops/sops/releases/latest/download/sops-linux-amd64
chmod +x sops-linux-amd64 && sudo mv sops-linux-amd64 /usr/local/bin/sops
```

### Generate key

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
# Prints: Public key: age1xxxxx...
```

### Add public key to .sops.yaml

Edit `.sops.yaml`, replace `age1PLACEHOLDER_REPLACE_WITH_YOUR_AGE_PUBLIC_KEY` with your public key.

### Create and encrypt secrets

```bash
cp .env.sops.yaml.example .env.sops.yaml
# Fill in values
sops --encrypt --in-place .env.sops.yaml
```

### Decrypt to .env

```bash
bash scripts/generate-env-from-vault.sh --sops
```

Para atualizar secrets de producao:

```bash
sops .env.sops.yaml
git add .env.sops.yaml .sops.yaml
git commit -m "chore: update encrypted production secrets"
bash scripts/deploy.sh 192.168.168.124
```

Nunca edite `.env.sops.yaml` sem `sops`; se o arquivo ficar em texto claro,
reverta antes de qualquer commit.

## JWT_SECRET Rotation

JWT rotation invalidates all active sessions. Coordinate with users.

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# Edit encrypted secrets
sops .env.sops.yaml
# Update JWT_SECRET

# Re-deploy
bash scripts/generate-env-from-vault.sh --sops
docker compose -f docker-compose.prod.yml restart api
# All users will need to log in again
```

## SYDLE Integration Secrets

O relatorio de compras e pagamentos internacionais usa somente SOPS/env para
credenciais. Nao armazenar token SYDLE em `system_settings`.

Variaveis:

- `SYDLE_SYNC_ENABLED`
- `SYDLE_BASE_URL`
- `SYDLE_API_TOKEN`
- `SYDLE_PAYMENTS_PATH`
- `SYDLE_AUTH_HEADER`
- `SYDLE_AUTH_SCHEME`
- `SYDLE_UPDATED_AFTER_PARAM`
- `SYDLE_PAGE_PARAM`
- `SYDLE_PAGE_SIZE_PARAM`
- `SYDLE_PAGE_SIZE`
- `SYDLE_TIMEOUT_MS`

Padrao seguro: `SYDLE_SYNC_ENABLED=false`. Com esse valor, o scheduler registra
`skipped` em `sydle_sync_runs` e nao tenta conectar na SYDLE.

## Access Control

| Person  | Role          | Key location                 |
| ------- | ------------- | ---------------------------- |
| Nicolas | Primary admin | .sops.yaml (add after setup) |

## Onboarding a New Admin

1. New admin runs: `age-keygen -o ~/.config/sops/age/keys.txt`
2. Shares their **public key** with existing admin
3. Existing admin adds key to `.sops.yaml` and runs: `sops updatekeys .env.sops.yaml`
4. Commit updated files
5. New admin can decrypt: `bash scripts/generate-env-from-vault.sh --sops`

## Offboarding an Admin

1. Remove their age public key from `.sops.yaml`
2. Rotate JWT_SECRET, POSTGRES_PASSWORD, all API keys
3. Run: `sops updatekeys .env.sops.yaml`
4. Commit and redeploy

## .gitignore Rules

- `.env` — NEVER commit
- `.env.sops.yaml` — NEVER commit unencrypted; commit only after `sops --encrypt`
- `.env.sops.yaml.example` — ALWAYS commit (no secrets)
- `.sops.yaml` — ALWAYS commit (public keys only)
