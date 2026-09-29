// AN-27 — "Zaman önerisi" mesaj tipi (KARAR-53 CEVAP ②④).
//
// KARAR-53: "ZAMAN ÖNERİSİ MESAJI: normal mesaj kanalından gider ama YAPILANDIRILMIŞ — menti NEDEN
// görüşmek istediğini anlatır + bir ZAMAN talep eder; mentör bunu sıradan mesajdan ayırt edebilir."
//
// Tasarım: ayrı uç/tablo YOK; `Message` satırı iki nullable alanla işaretlenir:
//   kind = 'TIME_PROPOSAL' · content = gerekçe (düz metin) · proposedStartAt = talep edilen zaman.
// Gerekçe content'te durduğu için önizleme, KVKK dışa aktarma ve anonimleştirme (content → '[silindi]')
// ek iş olmadan anlamlı kalır; eski istemci öneriyi sıradan mesaj gibi gösterir (bozulmaz).
// Randevu oluşturma akışına OTOMATİK bağlanmaz — öneri yalnız bir mesajdır (kapsam dışı, AN-27 kalanı).
//
// Saf fonksiyonlar: DB/HTTP bilmez → birim testle doğrulanır (tests/time-proposal.unit.test.ts).

export const MESSAGE_KIND = {
  TIME_PROPOSAL: 'TIME_PROPOSAL',
} as const;

export type MessageKind = (typeof MESSAGE_KIND)[keyof typeof MESSAGE_KIND];

/** İzin listesi — Zod `z.enum` bunu okur; listede olmayan tip 400 alır. */
export const MESSAGE_KINDS = [MESSAGE_KIND.TIME_PROPOSAL] as const;

export const TIME_PROPOSAL_CONFIG = {
  /** Gerekçe en az bu kadar karakter — "neden görüşmek istiyorum" gerçekten anlatılsın. */
  reasonMin: 10,
  /** Gerekçe üst sınırı (sıradan mesajın 2000 sınırından kısa: öneri kartında okunur kalsın). */
  reasonMax: 1000,
  /** Talep edilen zaman en fazla bu kadar gün ileride olabilir (yanlış yıl seçimi vb. yakalanır). */
  maxDaysAhead: 180,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ProposalWindowError = 'PAST' | 'TOO_FAR';

/** Talep edilen zaman makul aralıkta mı? Geçmiş/şimdi → PAST · üst sınırdan sonrası → TOO_FAR. */
export function checkProposalWindow(proposedStartAt: Date, now: Date): ProposalWindowError | null {
  const t = proposedStartAt.getTime();
  if (Number.isNaN(t) || t <= now.getTime()) return 'PAST';
  if (t > now.getTime() + TIME_PROPOSAL_CONFIG.maxDaysAhead * DAY_MS) return 'TOO_FAR';
  return null;
}

export const PROPOSAL_WINDOW_MESSAGES: Record<ProposalWindowError, string> = {
  PAST: 'Önerilen zaman ileri bir tarih olmalıdır.',
  TOO_FAR: `Önerilen zaman en fazla ${TIME_PROPOSAL_CONFIG.maxDaysAhead} gün sonrası olabilir.`,
};

export type TimeProposalIssue = { path: 'message' | 'proposedStartAt'; message: string };

/**
 * Mesaj gönderme gövdesinin zaman-önerisi kuralları (Zod superRefine bunu çağırır; `message` Zod'da
 * zaten trim + 1..2000 doğrulanmış gelir). Sıradan mesajda (kind yok) tarih gönderilemez; zaman
 * önerisinde gerekçe reasonMin..reasonMax, tarih zorunlu + ileri + en fazla maxDaysAhead gün.
 */
export function timeProposalIssues(
  input: { message: string; kind?: MessageKind; proposedStartAt?: string },
  now: Date,
): TimeProposalIssue[] {
  const issues: TimeProposalIssue[] = [];
  if (input.kind !== MESSAGE_KIND.TIME_PROPOSAL) {
    if (input.proposedStartAt !== undefined) {
      issues.push({ path: 'proposedStartAt', message: 'Tarih yalnız zaman önerisiyle gönderilebilir.' });
    }
    return issues;
  }
  if (input.message.length < TIME_PROPOSAL_CONFIG.reasonMin) {
    issues.push({
      path: 'message',
      message: `Neden görüşmek istediğinizi en az ${TIME_PROPOSAL_CONFIG.reasonMin} karakterle yazın.`,
    });
  }
  if (input.message.length > TIME_PROPOSAL_CONFIG.reasonMax) {
    issues.push({ path: 'message', message: `Gerekçe en fazla ${TIME_PROPOSAL_CONFIG.reasonMax} karakter olabilir.` });
  }
  if (!input.proposedStartAt) {
    issues.push({ path: 'proposedStartAt', message: 'Önerdiğiniz tarih ve saati seçin.' });
    return issues;
  }
  const windowError = checkProposalWindow(new Date(input.proposedStartAt), now);
  if (windowError) issues.push({ path: 'proposedStartAt', message: PROPOSAL_WINDOW_MESSAGES[windowError] });
  return issues;
}

/**
 * Konuşmadaki taraf bu tipte mesaj gönderebilir mi?
 * Sıradan mesaj (kind yok) → iki taraf da. Zaman önerisi → YALNIZ menti tarafı (KARAR-53: "menti ...
 * bir ZAMAN talep eder"). Taraf, kullanıcının global rolünden DEĞİL konuşmadaki yerinden gelir.
 */
export function canSendKind(side: 'mentor' | 'menti', kind: MessageKind | null | undefined): boolean {
  if (!kind) return true;
  if (kind === MESSAGE_KIND.TIME_PROPOSAL) return side === 'menti';
  return false;
}

/** Gelen kutusu önizlemesi: zaman önerisi sıradan mesajdan ayırt edilsin. */
export function previewPrefix(kind: string | null | undefined): string {
  return kind === MESSAGE_KIND.TIME_PROPOSAL ? 'Zaman önerisi · ' : '';
}
