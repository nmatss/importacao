import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { cache } from '../../shared/cache/redis.js';
import { logger } from '../../shared/utils/logger.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import {
  googleDriveService,
  ROOT_FOLDER_PLACEHOLDERS as PLACEHOLDERS,
} from '../integrations/google-drive.service.js';

const router = Router();

/**
 * GET /health/live — liveness probe
 * Returns 200 if the process is running. Expõe também o provider de IA ativo
 * e a revisão do build: o `.env` do repo pode divergir do de produção (drift
 * ialocal-vs-vertex da análise 2026-07-17) e este endpoint é a fonte de
 * verdade observável de qual provider realmente roda.
 */
router.get('/live', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    aiProvider: process.env.AI_PROVIDER || 'ialocal',
    revision: process.env.REVISION || null,
  });
});

/**
 * GET /health/ready — readiness probe
 * Checks DB and Redis connectivity before returning 200.
 * Returns 503 if any dependency is unavailable.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  // Check DB
  try {
    await db.execute(sql`SELECT 1`);
    checks.db = { ok: true };
  } catch (err: any) {
    logger.error({ err }, 'Health check: DB unavailable');
    checks.db = { ok: false, error: err.message };
  }

  // Check Redis
  try {
    await cache.set('health:ping', '1', 5);
    const val = await cache.get('health:ping');
    checks.redis = { ok: val === '1' };
  } catch (err: any) {
    logger.error({ err }, 'Health check: Redis unavailable');
    checks.redis = { ok: false, error: err.message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 200 : 503;

  res.status(status).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

function configured(value: string | undefined): boolean {
  const v = value?.trim();
  return !!v && !PLACEHOLDERS.has(v.toLowerCase());
}

/**
 * GET /health/integrations — quais integracoes estao realmente ligadas.
 *
 * Existe porque em 17/08 duas integracoes estavam inertes em producao sem que
 * nada comunicasse isso: `GOOGLE_DRIVE_ROOT_FOLDER_ID` estava com o
 * placeholder `your-root-folder-id` e `GOOGLE_SHEETS_FOLLOW_UP_ID` estava
 * vazio. O `/health/ready` ficava verde — ele cobre banco e Redis, e por
 * decisao explicita NAO deve bloquear por dependencia externa (reiniciar a API
 * nao conserta terceiro fora do ar). Entao a informacao precisava de um lugar
 * proprio, observavel, que nao derruba o readiness.
 *
 * Responde sempre 200: o objetivo e ser lido, nao reprovar deploy.
 *
 * ADMIN. Os irmaos `/live` e `/ready` sao publicos porque probe precisa
 * alcanca-los; este aqui descreve a postura de configuracao do ambiente
 * inteiro, e o projeto ja protege `/metrics` por token/IP pela mesma razao.
 * Nao expor superficie de configuracao a quem nao esta autenticado.
 */
router.get(
  '/integrations',
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    // A resposta do proprio servico, nao uma segunda opiniao. Reimplementar aqui
    // a nocao de "raiz configurada" criaria duas definicoes que podem divergir, e
    // um /health que mente e pior que um /health que nao existe.
    const driveRootOk = await googleDriveService.isRootConfigured().catch(() => false);

    const integracoes = {
      googleDrive: {
        credenciais: configured(process.env.GOOGLE_DRIVE_CLIENT_EMAIL),
        pastaRaiz: driveRootOk,
        pastaPreCons: configured(process.env.GOOGLE_DRIVE_PRE_CONS_FOLDER_ID),
      },
      followUpSheet: {
        planilha: configured(process.env.GOOGLE_SHEETS_FOLLOW_UP_ID),
        fonteDeReferencia: process.env.PROCESS_REFERENCE_SOURCE || 'follow_up',
      },
      documentos: {
        fonte: process.env.DOCUMENT_SOURCE || 'email',
        ingestaoEmail: process.env.EMAIL_INGESTION_ENABLED === 'true',
      },
      alertas: {
        canalChat: configured(process.env.GOOGLE_CHAT_WEBHOOK_URL),
      },
      ia: {
        provider: process.env.AI_PROVIDER || 'ialocal',
        externoPermitido: process.env.AI_ALLOW_EXTERNAL === 'true',
      },
    };

    // Cada aviso e uma integracao que o operador provavelmente pensa estar
    // ligada e nao esta.
    const avisos: string[] = [];
    if (!integracoes.googleDrive.pastaRaiz) {
      avisos.push('GOOGLE_DRIVE_ROOT_FOLDER_ID ausente ou placeholder — Drive inativo');
    }
    if (!integracoes.followUpSheet.planilha) {
      avisos.push(
        'GOOGLE_SHEETS_FOLLOW_UP_ID vazio — allow-list da Follow Up degrada para o fluxo antigo',
      );
    }
    if (integracoes.documentos.fonte !== 'email' && !integracoes.googleDrive.pastaRaiz) {
      avisos.push('DOCUMENT_SOURCE inclui drive mas a pasta raiz nao esta configurada');
    }
    if (!integracoes.alertas.canalChat) {
      avisos.push('GOOGLE_CHAT_WEBHOOK_URL ausente — alertas nao saem do banco');
    }

    res.json({ timestamp: new Date().toISOString(), integracoes, avisos });
  },
);

export { router as healthRoutes };
