import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { and, eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { users } from '../../shared/database/schema.js';
import type { CreateUserInput, UpdateUserInput } from './schema.js';
import { auditService } from '../audit/service.js';
import { googleGroupsService } from '../integrations/google-groups.service.js';
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../shared/errors/index.js';
import { isNetworkError } from '../../shared/utils/resilience.js';
import { logger } from '../../shared/utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export type LoginFailureReason =
  | 'network_error'
  | 'invalid_token'
  | 'email_not_verified'
  | 'wrong_domain'
  | 'not_in_group'
  | 'inactive_user'
  | 'unknown_user';

/**
 * Ator de uma operacao administrativa sobre contas.
 *
 * Ate 29/08 `user.created`, `user.updated` e `user.deleted` iam para
 * `audit_logs` com `userId = null` e `ipAddress = null`: quem promoveu ou
 * desativou alguem nao ficava registrado em lugar nenhum.
 */
export interface AuditActor {
  id: number | null;
  ip?: string | null;
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : 'desconhecido';
}

/**
 * Registra por que uma tentativa de login falhou.
 *
 * Ate 17/08 so o caso `not_in_group` deixava rastro; os demais — inclusive a
 * falha de REDE, que derrubou o acesso por 12 dias em 08/2026 — sumiam sem
 * registro. Como `audit_logs` so guardava login bem-sucedido, o unico detector
 * de problema de acesso passou a ser a usuaria reclamando no WhatsApp.
 *
 * LGPD: guarda o e-mail apenas quando ele ja e nosso (usuario existente na
 * base). Para dominio de fora vai so o dominio — suficiente para investigar,
 * sem colecionar endereco de terceiro.
 *
 * Nunca lanca: instrumentacao nao pode derrubar o fluxo que observa.
 */
export async function recordLoginFailure(
  userId: number | null,
  reason: LoginFailureReason,
  emailOrDomain?: string,
): Promise<void> {
  try {
    await auditService.log(
      userId,
      'login_failed',
      'user',
      userId,
      { reason, ...(emailOrDomain ? { origem: emailOrDomain } : {}) },
      null,
    );
  } catch (err) {
    logger.warn({ err, reason }, 'Falha ao registrar tentativa de login malsucedida');
  }
}

/**
 * Impede que a ultima conta de administrador ativa seja desativada ou
 * rebaixada a analista.
 *
 * `authMiddleware` devolve 401 para conta inativa, entao quem se desativa e
 * deslogado na requisicao seguinte. Se era o ultimo admin, nao sobra ninguem
 * capaz de reativa-lo pela tela — o unico caminho de volta e SQL direto no
 * banco de producao.
 *
 * So consulta o banco quando o alvo e, de fato, um admin ativo.
 */
async function assertNotLastActiveAdmin(
  targetId: number,
  action: 'desativar' | 'rebaixar',
): Promise<void> {
  const [target] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  // Alvo inexistente (o update devolve "nao encontrado" adiante) ou que ja nao
  // e admin ativo nao altera a contagem de administradores.
  if (!target || target.role !== 'admin' || !target.isActive) return;

  const activeAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(2);

  if (activeAdmins.length <= 1) {
    throw new ConflictError(
      `Não é possível ${action} o último administrador ativo. Promova outro usuário a administrador antes.`,
    );
  }
}

export const authService = {
  async login(email: string, password: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.isActive) {
      // Este caminho ja registrava; nao duplicar.
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email, reason: 'invalid_credentials' },
        null,
      );
      throw new UnauthorizedError('Credenciais inválidas');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email, reason: 'invalid_credentials' },
        null,
      );
      throw new UnauthorizedError('Credenciais inválidas');
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    auditService.log(user.id, 'login', 'user', user.id, { email: user.email }, null);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async loginWithGoogle(credential: string) {
    // verifyIdToken tambem busca as chaves publicas do Google pela rede. Sem
    // separar os dois casos, uma queda de rede era reportada como credencial
    // invalida (401) e o front mostrava "sessao expirou".
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        logger.error({ err }, 'Google: falha de rede ao verificar o id_token');
        // Ate 17/08 apenas o caso `not_in_group` deixava rastro. Justamente o
        // caminho de rede — o que derrubou o login por 12 dias em 08/2026 —
        // sumia sem registro, e o unico detector virou a usuaria no WhatsApp.
        await recordLoginFailure(null, 'network_error');
        throw new ServiceUnavailableError(
          'Nao foi possivel falar com o Google agora. Tente novamente em alguns minutos.',
        );
      }
      await recordLoginFailure(null, 'invalid_token');
      throw new UnauthorizedError('Token Google inválido');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      await recordLoginFailure(null, 'invalid_token');
      throw new UnauthorizedError('Token Google inválido');
    }

    // O Google so afirma que o endereco pertence a quem apresentou o token
    // quando `email_verified` e true. Sem esta checagem, um tenant que aceite
    // e-mail nao verificado permite apresentar o endereco de outra pessoa.
    if (payload.email_verified !== true) {
      logger.warn({ dominio: domainOf(payload.email) }, 'Google: id_token sem email_verified');
      await recordLoginFailure(null, 'email_not_verified', domainOf(payload.email));
      throw new UnauthorizedError('Token Google inválido');
    }

    if (ALLOWED_DOMAIN) {
      // `hd` (hosted domain) e o claim que o Google emite para conta Workspace.
      // A checagem e CONDICIONAL DE PROPOSITO — nao endureca para exigir a
      // presenca do claim sem entender o custo:
      //
      // - `hd` PRESENTE e divergente => recusa dura. Este e o caso que importa:
      //   conta de OUTRA organizacao tentando entrar.
      // - `hd` AUSENTE => segue para as barreiras seguintes (sufixo do e-mail e
      //   grupos do Google), sem recusar por isso.
      //
      // Exigir a presenca do claim tem modo de falha catastrofico e binario: se
      // o Google parar de emitir `hd` (mudanca de formato do token, conta que
      // nao e Workspace), NINGUEM entra, e a recuperacao exige mexer em
      // ALLOWED_DOMAIN no SOPS e redeployar no meio do incidente de login.
      //
      // O que a exigencia dura acrescentaria ja esta coberto: a ameaca e conta
      // de fora apresentando um e-mail do dominio, e `email_verified === true`
      // acima ja e obrigatorio. O Google nao emite e-mail verificado
      // @ALLOWED_DOMAIN para conta de consumidor — quem tem esse endereco
      // verificado esta no Workspace e, ai sim, vem com `hd`.
      const hostedDomainOk = payload.hd == null || payload.hd === ALLOWED_DOMAIN;
      const emailSuffixOk = payload.email.endsWith(`@${ALLOWED_DOMAIN}`);

      if (!hostedDomainOk || !emailSuffixOk) {
        // Dominio de fora: guarda so o dominio, nunca o endereco completo. E
        // pessoa que nao e nossa, e o dominio ja basta para investigar.
        logger.warn(
          {
            hd: payload.hd ?? null,
            dominio: domainOf(payload.email),
            hostedDomainOk,
            emailSuffixOk,
          },
          'Google: conta fora do dominio corporativo',
        );
        await recordLoginFailure(null, 'wrong_domain', domainOf(payload.email));
        throw new ForbiddenError(`Acesso restrito a contas @${ALLOWED_DOMAIN}`);
      }
    }

    const allowed = await googleGroupsService.isAllowed(payload.email);
    if (!allowed) {
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email: payload.email, reason: 'not_in_group' },
        null,
      );
      throw new ForbiddenError('Acesso negado: usuário não pertence ao grupo autorizado');
    }

    let [user] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1);

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      [user] = await db
        .insert(users)
        .values({
          name: payload.name || payload.email.split('@')[0],
          email: payload.email,
          passwordHash,
          role: 'analyst',
        })
        .returning();
    }

    if (!user.isActive) {
      await recordLoginFailure(user.id, 'inactive_user', payload.email);
      throw new ForbiddenError('Conta desativada');
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    auditService.log(user.id, 'login_google', 'user', user.id, { email: user.email }, null);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async getMe(userId: number) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new Error('Usuário não encontrado');
    return user;
  },

  async listUsers() {
    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .limit(100);
  },

  async createUser(input: CreateUserInput, actor?: AuditActor) {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const [user] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      });
    await auditService.log(
      actor?.id ?? null,
      'user.created',
      'user',
      user.id,
      { email: user.email },
      actor?.ip ?? null,
    );
    return user;
  },

  async updateUser(id: number, input: UpdateUserInput, actor?: AuditActor) {
    const deactivating = input.isActive === false;
    const demoting = input.role === 'analyst';

    // Auto-bloqueio: nem o admin mais convicto deve conseguir se desativar ou
    // se rebaixar pela propria interface — na requisicao seguinte ele ja nao
    // tem permissao para desfazer.
    if (actor?.id != null && actor.id === id && (deactivating || demoting)) {
      throw new ConflictError(
        deactivating
          ? 'Você não pode desativar a própria conta. Peça a outro administrador.'
          : 'Você não pode rebaixar o próprio papel de administrador. Peça a outro administrador.',
      );
    }

    if (deactivating) await assertNotLastActiveAdmin(id, 'desativar');
    else if (demoting) await assertNotLastActiveAdmin(id, 'rebaixar');

    const updates: Record<string, any> = { ...input, updatedAt: new Date() };
    if (input.password) {
      updates.passwordHash = await bcrypt.hash(input.password, 10);
      delete updates.password;
    }

    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });

    if (!user) throw new Error('Usuário não encontrado');
    await auditService.log(
      actor?.id ?? null,
      'user.updated',
      'user',
      user.id,
      { email: user.email },
      actor?.ip ?? null,
    );
    return user;
  },

  async deleteUser(id: number, actor?: AuditActor) {
    if (actor?.id != null && actor.id === id) {
      throw new ConflictError(
        'Você não pode desativar a própria conta. Peça a outro administrador.',
      );
    }

    await assertNotLastActiveAdmin(id, 'desativar');

    const [user] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!user) throw new Error('Usuário não encontrado');
    await auditService.log(
      actor?.id ?? null,
      'user.deleted',
      'user',
      user.id,
      null,
      actor?.ip ?? null,
    );
    return user;
  },
};
