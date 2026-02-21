import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { systemSettings } from '../../shared/database/schema.js';

export const settingsService = {
  async getAll() {
    return db.select().from(systemSettings);
  },

  async get(key: string) {
    const [setting] = await db.select().from(systemSettings)
      .where(eq(systemSettings.key, key)).limit(1);
    return setting;
  },

  async set(key: string, value: any, description?: string) {
    const existing = await this.get(key);

    if (existing) {
      const [updated] = await db.update(systemSettings)
        .set({ value, description, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();
      return updated;
    }

    const [created] = await db.insert(systemSettings)
      .values({ key, value, description })
      .returning();
    return created;
  },
};
