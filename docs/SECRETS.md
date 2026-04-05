# Secrets Management

## Overview

Secrets are managed via SOPS + age (preferred) or HashiCorp Vault (legacy).

| Method | Tool needed |
|--------|-------------|
| SOPS + age | `sops`, `age` |
| Vault | `vault` CLI + vault-central container |

## SOPS + age Setup

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

## Access Control

| Person | Role | Key location |
|--------|------|-------------|
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
