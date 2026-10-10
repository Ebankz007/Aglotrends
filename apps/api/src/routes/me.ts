import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const [wallet] = await db
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.userId, req.user!.id));
    if (!wallet) throw ApiError.notFound('Wallet not found');
    res.json({ balanceCents: wallet.balanceCents });
  }),
);

meRouter.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.userId, req.user!.id))
      .orderBy(desc(schema.ledgerEntries.createdAt))
      .limit(200);
    res.json({ entries: rows });
  }),
);

meRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, req.user!.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(100);
    res.json({ notifications: rows });
  }),
);

const prefsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  whatsappNumber: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
});

meRouter.get(
  '/notification-settings',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select()
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.userId, req.user!.id));
    res.json({
      settings: row ?? {
        emailEnabled: true,
        whatsappEnabled: false,
        telegramEnabled: false,
        whatsappNumber: null,
        telegramChatId: null,
      },
    });
  }),
);

meRouter.put(
  '/notification-settings',
  asyncHandler(async (req, res) => {
    const body = prefsSchema.parse(req.body);
    const [row] = await db
      .insert(schema.notificationSettings)
      .values({
        userId: req.user!.id,
        emailEnabled: body.emailEnabled ?? true,
        whatsappEnabled: body.whatsappEnabled ?? false,
        telegramEnabled: body.telegramEnabled ?? false,
        whatsappNumber: body.whatsappNumber ?? null,
        telegramChatId: body.telegramChatId ?? null,
      })
      .onConflictDoUpdate({
        target: schema.notificationSettings.userId,
        set: {
          emailEnabled: body.emailEnabled ?? true,
          whatsappEnabled: body.whatsappEnabled ?? false,
          telegramEnabled: body.telegramEnabled ?? false,
          whatsappNumber: body.whatsappNumber ?? null,
          telegramChatId: body.telegramChatId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.json({ settings: row });
  }),
);
