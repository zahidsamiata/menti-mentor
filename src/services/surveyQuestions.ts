/**
 * AN-52 — Ürün-içi otomatik geri bildirim soruları: TEK config listesi (sihirli dize yok kuralı).
 *
 * Kaynak: docs/raporlar/kesif/an52-urun-ici-geri-bildirim-plani-2026-09-27.md §1 (S1-S7) + §2.
 * "Tek kutu, tek migration" (KARAR-80/M12): yeni bir soru eklemek İÇİN bu listeye yeni bir
 * SurveyQuestionDef satırı eklenir — migration GEREKMEZ (ProductSurveyResponse.questionKey
 * serbest metin; bkz. prisma/schema.prisma).
 *
 * `triggerContext`: frontend'in "bu anı gördüm" dediği tetikleyici anahtarı (§2 tablosu).
 * Bu PR yalnız backend sözleşmesini tanımlar; hangi ekranın hangi context'i ne zaman
 * göndereceği AN-52-3'ün kapsamındadır (frontend YOK — bu PR'da yalnız backend).
 *
 * Ton kısıtı (§2, KARAR-71 cevaplanana kadar en muhafazakâr yorum): tüm metinler nötr,
 * suçlayıcı/baskı dili YOK.
 */

export type SurveyRole = 'MENTOR' | 'MENTI';

export interface SurveyOption {
  key: string;
  label: string;
}

export interface SurveyQuestionDef {
  questionKey: string;
  triggerContext: string;
  /** Bu soruyu hangi rol(ler) görebilir/cevaplayabilir. */
  roles: readonly SurveyRole[];
  text: string;
  options: readonly SurveyOption[];
}

export const SURVEY_QUESTIONS: readonly SurveyQuestionDef[] = [
  {
    questionKey: 'S1_BEKLEME',
    triggerContext: 'MENTI_BEKLEME',
    roles: ['MENTI'],
    text: 'Şu anki bekleyişin senin için nasıl geçiyor?',
    options: [
      { key: 'RAHAT', label: 'Rahat' },
      { key: 'BIRAZ_SIKINTILI', label: 'Biraz sıkıntılı' },
      { key: 'ENDISELIYIM', label: 'Endişeliyim' },
    ],
  },
  {
    questionKey: 'S2_ILK_TALEP',
    triggerContext: 'ILK_TALEP_GONDERILDI',
    roles: ['MENTI'],
    text: 'İlk görüşme talebini göndermek nasıldı?',
    options: [
      { key: 'KOLAYDI', label: 'Kolaydı' },
      { key: 'BIRAZ_CEKINDIM', label: 'Biraz çekindim' },
      { key: 'ZOR_GELDI', label: 'Zor geldi, epey düşündüm' },
    ],
  },
  {
    questionKey: 'S3_MENTORLUGE_BASLAMA',
    triggerContext: 'MENTOR_ONBOARDING_TAMAMLANDI',
    roles: ['MENTOR'],
    text: 'Mentör olmaya nasıl karar verdin?',
    options: [
      { key: 'KENDIM_ISTEDIM', label: 'Kendim istedim' },
      { key: 'TANIDIK_ONERDI', label: 'Bir tanıdığım/arkadaşım önerdi' },
      { key: 'KURUM_YONLENDIRDI', label: 'Kurumum yönlendirdi' },
      { key: 'DIGER', label: 'Diğer' },
    ],
  },
  {
    // İki varsayımı kümeler (MT-A2 + M-A2, plan §1 "KÜMELE" ilkesi).
    questionKey: 'S4_KAPASITE',
    triggerContext: 'MENTOR_PANEL_ACILIS',
    roles: ['MENTOR'],
    text: 'Şu an aktif mentorluk yaptığın kişi sayısını düşünürsen, daha fazla mentiye açık mısın?',
    options: [
      { key: 'EVET_ACIGIM', label: 'Evet, daha fazla alabilirim' },
      { key: 'TAM_KAPASITE', label: 'Şu an tam kapasiteyim' },
      { key: 'AZALTMAYI_DUSUNUYORUM', label: 'Kapasitemi azaltmayı düşünüyorum' },
    ],
  },
  {
    questionKey: 'S5_TAKDIR',
    triggerContext: 'MENTOR_TAKDIR_KARTI',
    roles: ['MENTOR'],
    text: 'Mentörlükte seni en çok ne motive ediyor?',
    options: [
      { key: 'KATKI', label: 'Katkı sağladığımı görmek' },
      { key: 'TAKDIR', label: 'Takdir edilmek (rozet/sertifika)' },
      { key: 'BAGLANTI', label: 'Yeni bağlantılar kurmak' },
      { key: 'DIGER', label: 'Diğer' },
    ],
  },
  {
    questionKey: 'S6_GERI_DONUS',
    triggerContext: 'IKINCI_GIRIS',
    roles: ['MENTOR', 'MENTI'],
    text: 'Bugün tekrar gelmene ne sebep oldu?',
    options: [
      { key: 'BILDIRIM', label: 'Bir bildirim/hatırlatma gördüm' },
      { key: 'KENDILIGINDEN', label: 'Kendiliğinden aklıma geldi' },
      { key: 'BEKLEYEN_ISLEM', label: 'Bekleyen bir görüşmem/mesajım vardı' },
      { key: 'DIGER', label: 'Diğer' },
    ],
  },
  {
    questionKey: 'S7_RET_SONRASI',
    triggerContext: 'GORUSME_REDDEDILDI',
    roles: ['MENTI'],
    text: 'Bu mesajı okuduktan sonra nasıl hissettin?',
    options: [
      { key: 'ANLADIM', label: 'Anladım, sorun değil' },
      { key: 'UZULDUM', label: 'Yine de biraz üzüldüm' },
      { key: 'MERAK_EDIYORUM', label: 'Neden reddedildiğimi merak ediyorum' },
    ],
  },
] as const;

const BY_KEY: ReadonlyMap<string, SurveyQuestionDef> = new Map(
  SURVEY_QUESTIONS.map((q) => [q.questionKey, q]),
);
const BY_CONTEXT: ReadonlyMap<string, SurveyQuestionDef> = new Map(
  SURVEY_QUESTIONS.map((q) => [q.triggerContext, q]),
);

export function getSurveyQuestionByKey(questionKey: string): SurveyQuestionDef | undefined {
  return BY_KEY.get(questionKey);
}

export function getSurveyQuestionByContext(triggerContext: string): SurveyQuestionDef | undefined {
  return BY_CONTEXT.get(triggerContext);
}

/** Zod `z.enum(...)` girdisi için — geçerli questionKey/context değerlerinin listesi. */
export const SURVEY_QUESTION_KEYS = SURVEY_QUESTIONS.map((q) => q.questionKey) as [string, ...string[]];
export const SURVEY_TRIGGER_CONTEXTS = SURVEY_QUESTIONS.map((q) => q.triggerContext) as [string, ...string[]];
