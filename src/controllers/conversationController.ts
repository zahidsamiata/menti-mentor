import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { canCrossTenantMatch } from '../services/tenantSharing.js';
import { notifyMatchRequestReceived } from '../services/notificationService.js';

// Chat v1 — menti↔mentör talep mesajlaşma.
// Güvenlik sınırı KATILIMCIDIR (tenant değil): shared-pool'da taraflar farklı
// tenant'ta olabilir. Her endpoint çağıranın O konuşmanın tarafı (mentor/menti)
// veya aynı-tenant admin olduğunu doğrular; değilse 404 (varlık ifşasını gizle).
// PII: mesaj içeriği (content) ASLA log'a yazılmaz (backend CLAUDE.md).

const MESSAGE_MAX = 2000;
const PREVIEW_LEN = 90;

const MessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Mesaj boş olamaz.')
    .max(MESSAGE_MAX, `Mesaj en fazla ${MESSAGE_MAX} karakter olabilir.`),
});

const StartSchema = MessageSchema.extend({
  // Menti bir mentöre zorunlu ilk mesajla konuşma açar (hemen açık, kabul adımı yok).
  mentorUserId: z.string().min(5),
});

type ConvoCore = {
  id: string;
  tenantId: string;
  mentorUserId: string;
  mentiUserId: string;
  mentorLastReadAt: Date | null;
  mentiLastReadAt: Date | null;
};

type Side = 'mentor' | 'menti';

function sideOf(convo: Pick<ConvoCore, 'mentorUserId' | 'mentiUserId'>, userId: string): Side | null {
  if (convo.mentorUserId === userId) return 'mentor';
  if (convo.mentiUserId === userId) return 'menti';
  return null;
}

function lastReadForSide(convo: ConvoCore, side: Side): Date | null {
  return side === 'mentor' ? convo.mentorLastReadAt : convo.mentiLastReadAt;
}

/** Katılımcı VEYA konuşmanın tenant'ında ADMIN erişebilir. */
function canAccess(convo: ConvoCore, req: RequestWithTenant): boolean {
  if (!req.auth) return false;
  if (sideOf(convo, req.auth.userId)) return true;
  return req.auth.role === 'ADMIN' && req.tenant.tenantId === convo.tenantId;
}

function preview(content: string): string {
  const t = content.trim();
  return t.length > PREVIEW_LEN ? `${t.slice(0, PREVIEW_LEN)}…` : t;
}

const counterpartSelect = { id: true, fullName: true, avatarUrl: true, role: true } as const;

// ─── POST /api/conversations — menti konuşma başlatır (zorunlu ilk mesaj) ──────
export async function startConversation(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const mentiId = req.auth.userId;
  const tenantId = req.tenant.tenantId;

  // Talep sahibi = kimliği doğrulanmış menti (body'den değil — IDOR önleme), kendi tenant'ında aktif.
  const menti = await prisma.user.findFirst({
    where: { id: mentiId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!menti) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  // Hedef mentör başka tenant'ta olabilir (shared pool). findUnique RLS'ten muaftır (bkz. db.ts);
  // ardından canCrossTenantMatch paylaşım iznini zorlar — guard olmadan herhangi bir tenant'ın
  // mentörüne konuşma açılabilirdi.
  const mentor = await prisma.user.findUnique({
    where: { id: parsed.data.mentorUserId },
    select: { id: true, role: true, isActive: true, tenantId: true },
  });
  if (!mentor || mentor.role !== 'MENTOR' || !mentor.isActive) {
    return res.status(400).json({ error: 'TARGET', message: 'Hedef kullanıcı aktif bir mentör olmalıdır.' });
  }
  const crossAllowed = await canCrossTenantMatch({
    requesterTenantId: tenantId,
    targetTenantId: mentor.tenantId,
  });
  if (!crossAllowed) {
    return res.status(403).json({
      error: 'SHARED_POOL_KAPALI',
      message: 'Bu mentörün tenant havuzu kapalı olduğu için konuşma başlatılamaz.',
    });
  }

  // Bir menti↔mentör çifti için tek konuşma. Yoksa oluştur (+ MatchRequest'e bağla);
  // varsa mevcut konuşmaya yeni mesaj ekle (idempotent — tekrar "talep" konuşmayı çoğaltmaz).
  let convo = await prisma.conversation.findUnique({
    where: { mentorUserId_mentiUserId: { mentorUserId: mentor.id, mentiUserId: mentiId } },
  });
  let isNew = false;
  if (!convo) {
    const matchRequest = await prisma.matchRequest.create({
      data: { tenantId, requesterUserId: mentiId, targetType: 'USER', targetId: mentor.id },
    });
    convo = await prisma.conversation.create({
      data: { tenantId, mentorUserId: mentor.id, mentiUserId: mentiId, matchRequestId: matchRequest.id },
    });
    isNew = true;
  }

  const msg = await prisma.message.create({
    data: { conversationId: convo.id, senderUserId: mentiId, content: parsed.data.message },
  });
  // Gönderen kendi mesajını okumuş sayılır → menti tarafı unread=0.
  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastMessageAt: msg.createdAt, mentiLastReadAt: msg.createdAt },
  });

  // Mentöre anlık bildirim (yeni konuşma). Devam eden mesajlarda in-app unread'den türetilir.
  if (isNew) void notifyMatchRequestReceived(mentor.id, tenantId);

  return res.status(201).json({
    conversation: { id: convo.id },
    message: { id: msg.id, senderUserId: msg.senderUserId, content: msg.content, createdAt: msg.createdAt },
  });
}

// ─── POST /api/conversations/:id/messages — mesaj gönder (katılımcı) ───────────
export async function sendMessage(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const parsed = MessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const convo = await prisma.conversation.findUnique({ where: { id: req.params['id'] as string } });
  if (!convo) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }
  // Yalnız konuşmanın tarafları yazabilir (admin dahil değil). Değilse 404 — varlık ifşasını gizle.
  const side = sideOf(convo, req.auth.userId);
  if (!side) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }

  const msg = await prisma.message.create({
    data: { conversationId: convo.id, senderUserId: req.auth.userId, content: parsed.data.message },
  });
  const readField = side === 'mentor'
    ? { mentorLastReadAt: msg.createdAt }
    : { mentiLastReadAt: msg.createdAt };
  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastMessageAt: msg.createdAt, ...readField },
  });

  // NOT: Okundu-bazlı e-posta tetiği Tur 3'te bu noktaya eklenir.

  return res.status(201).json({
    message: { id: msg.id, senderUserId: msg.senderUserId, content: msg.content, createdAt: msg.createdAt },
  });
}

// ─── GET /api/conversations — kullanıcının inbox'ı (+ unread) ──────────────────
export async function listConversations(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const me = req.auth.userId;

  const convos = await prisma.conversation.findMany({
    where: { OR: [{ mentorUserId: me }, { mentiUserId: me }] },
    orderBy: { lastMessageAt: 'desc' },
    include: { mentor: { select: counterpartSelect }, menti: { select: counterpartSelect } },
  });

  const items = await Promise.all(
    convos.map(async (c) => {
      const side = sideOf(c, me)!;
      const lastRead = lastReadForSide(c, side);
      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          senderUserId: { not: me },
          ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
        },
      });
      const last = await prisma.message.findFirst({
        where: { conversationId: c.id },
        orderBy: { createdAt: 'desc' },
        select: { content: true, createdAt: true, senderUserId: true },
      });
      const counterpart = side === 'mentor' ? c.menti : c.mentor;
      return {
        id: c.id,
        counterpart,
        lastMessagePreview: last ? preview(last.content) : null,
        lastMessageAt: c.lastMessageAt,
        unread,
      };
    }),
  );

  return res.json({ items, total: items.length });
}

// ─── GET /api/conversations/:id/messages — thread (kronolojik) ─────────────────
export async function getMessages(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const convo = await prisma.conversation.findUnique({
    where: { id: req.params['id'] as string },
    include: { mentor: { select: counterpartSelect }, menti: { select: counterpartSelect } },
  });
  if (!convo) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }
  // IDOR: yalnız taraflar veya aynı-tenant admin. Yetkisizde 404 (PII varlık ifşasını gizle).
  if (!canAccess(convo, req)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderUserId: true, content: true, createdAt: true },
  });
  const side = sideOf(convo, req.auth.userId);
  const counterpart = side === 'mentor' ? convo.menti : side === 'menti' ? convo.mentor : null;

  return res.json({
    id: convo.id,
    mentor: convo.mentor,
    menti: convo.menti,
    counterpart,
    messages,
  });
}

// ─── POST /api/conversations/:id/read — okundu işaretle ────────────────────────
export async function markRead(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const convo = await prisma.conversation.findUnique({ where: { id: req.params['id'] as string } });
  if (!convo) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }
  // Okundu yalnız tarafın kendi işaretidir (admin okundu yazmaz).
  const side = sideOf(convo, req.auth.userId);
  if (!side) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Konuşma bulunamadı.' });
  }

  const now = new Date();
  const data = side === 'mentor' ? { mentorLastReadAt: now } : { mentiLastReadAt: now };
  await prisma.conversation.update({ where: { id: convo.id }, data });

  return res.json({ ok: true, readAt: now.toISOString() });
}

// ─── GET /api/conversations/unread-count — çan rozeti için toplam unread ───────
export async function unreadCount(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const me = req.auth.userId;
  const convos = await prisma.conversation.findMany({
    where: { OR: [{ mentorUserId: me }, { mentiUserId: me }] },
    select: {
      id: true,
      tenantId: true,
      mentorUserId: true,
      mentiUserId: true,
      mentorLastReadAt: true,
      mentiLastReadAt: true,
    },
  });

  const perConvo = await Promise.all(
    convos.map((c) => {
      const side = sideOf(c, me)!;
      const lastRead = lastReadForSide(c, side);
      return prisma.message.count({
        where: {
          conversationId: c.id,
          senderUserId: { not: me },
          ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
        },
      });
    }),
  );

  const count = perConvo.reduce((a, b) => a + b, 0);
  return res.json({ count });
}
