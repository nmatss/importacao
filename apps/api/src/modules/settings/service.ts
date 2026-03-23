import { eq, and } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { systemSettings, emailSignatures } from '../../shared/database/schema.js';

export const settingsService = {
  async getAll() {
    return db.select().from(systemSettings).limit(100);
  },

  async get(key: string) {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    return setting;
  },

  async set(key: string, value: any, description?: string) {
    const existing = await this.get(key);

    if (existing) {
      const [updated] = await db
        .update(systemSettings)
        .set({ value, description, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(systemSettings)
      .values({ key, value, description })
      .returning();
    return created;
  },

  // ── Email Signatures ────────────────────────────────────────────────

  async getSignatures(userId: number) {
    return db
      .select()
      .from(emailSignatures)
      .where(eq(emailSignatures.userId, userId))
      .orderBy(emailSignatures.name);
  },

  async getSignatureById(id: number) {
    const [signature] = await db
      .select()
      .from(emailSignatures)
      .where(eq(emailSignatures.id, id))
      .limit(1);
    return signature ?? null;
  },

  async createSignature(
    userId: number,
    data: { name: string; signatureHtml: string; isDefault?: boolean },
  ) {
    // Enforce max 4 signatures per user
    const existing = await this.getSignatures(userId);
    if (existing.length >= 4) {
      throw Object.assign(new Error('Limite de 4 assinaturas por usuario atingido'), {
        statusCode: 400,
      });
    }

    // If setting as default, unset others first
    if (data.isDefault) {
      await db
        .update(emailSignatures)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(emailSignatures.userId, userId));
    }

    // If this is the first signature, make it default
    const isDefault = data.isDefault || existing.length === 0;

    const [created] = await db
      .insert(emailSignatures)
      .values({
        userId,
        name: data.name,
        signatureHtml: data.signatureHtml,
        isDefault,
      })
      .returning();
    return created;
  },

  async updateSignature(
    id: number,
    userId: number,
    data: { name?: string; signatureHtml?: string; isDefault?: boolean },
  ) {
    // Verify ownership
    const [signature] = await db
      .select()
      .from(emailSignatures)
      .where(and(eq(emailSignatures.id, id), eq(emailSignatures.userId, userId)))
      .limit(1);

    if (!signature) {
      throw Object.assign(new Error('Assinatura nao encontrada'), { statusCode: 404 });
    }

    // If setting as default, unset others first
    if (data.isDefault) {
      await db
        .update(emailSignatures)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(emailSignatures.userId, userId));
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.signatureHtml !== undefined) updateData.signatureHtml = data.signatureHtml;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    const [updated] = await db
      .update(emailSignatures)
      .set(updateData)
      .where(eq(emailSignatures.id, id))
      .returning();
    return updated;
  },

  async deleteSignature(id: number, userId: number) {
    // Verify ownership
    const [signature] = await db
      .select()
      .from(emailSignatures)
      .where(and(eq(emailSignatures.id, id), eq(emailSignatures.userId, userId)))
      .limit(1);

    if (!signature) {
      throw Object.assign(new Error('Assinatura nao encontrada'), { statusCode: 404 });
    }

    await db.delete(emailSignatures).where(eq(emailSignatures.id, id));

    // If deleted one was default, make the first remaining one default
    if (signature.isDefault) {
      const remaining = await this.getSignatures(userId);
      if (remaining.length > 0) {
        await db
          .update(emailSignatures)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(emailSignatures.id, remaining[0].id));
      }
    }

    return { deleted: true };
  },
};
