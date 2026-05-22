export type UserRole = 'ADMIN' | 'MENTOR' | 'MENTI';
export type DiscType = 'D' | 'I' | 'S' | 'C';
export type MeetingStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type ClubType = 'AKADEMIK' | 'SOSYAL' | 'SPOR' | 'SANAT' | 'TEKNOLOJI' | 'DIGER';
export type ClubMemberRole = 'BASKAN' | 'YONETIM' | 'UYE' | 'DANISMAN';
export type TimeCommitment = 'AYDA_1' | 'AYDA_2_3' | 'HAFTADA_1' | 'HAFTADA_2_PLUS';
export type ExpectationCategory =
  | 'KARIYER_YONLENDIRME'
  | 'TEKNIK_BECERI'
  | 'IS_STAJ_BAGLANTISI'
  | 'GIRISIMCILIK'
  | 'KISISEL_GELISIM'
  | 'SEKTOR_TANIMA';

export interface User {
  id: string;
  role: UserRole;
  fullName: string;
  email: string;
  isActive: boolean;
  discType: DiscType | null;
  sectorTags: string[];
  skills: string[];
  bioSummary: string | null;
  expertiseDetails: string | null;
  targetAudience: string | null;
  needsOrientation: boolean;
  timeCommitment: TimeCommitment | null;
  expectationCategories: ExpectationCategory[];
  interactionStyle: string | null;
  discVector: Record<string, number> | null;
  selfProfile: Record<string, unknown> | null;
  createdAt: string;
}

export interface RankedMenti {
  id: string;
  fullName: string;
  email: string;
  discType: DiscType | null;
  sectorTags: string[];
  skills: string[];
  bioSummary: string | null;
  needsOrientation: boolean;
  score: number;
  iceBreaker: string | null;
}

export interface Meeting {
  id: string;
  tenantId: string;
  mentorId: string;
  mentiId: string;
  scheduledAt: string;
  status: MeetingStatus;
  hasFeedback: boolean;
  createdAt: string;
  updatedAt: string;
  mentor: { id: string; fullName: string };
  menti: { id: string; fullName: string };
}

export interface Feedback {
  id: string;
  meetingId: string;
  guidanceScore: number | null;
  resourceSharingScore: number | null;
  trustScore: number | null;
  preparednessScore: number | null;
  proactivityScore: number | null;
  keyLearnings: string | null;
  specificComments: string | null;
  createdAt: string;
}

export interface Club {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  type: ClubType;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ClubMembership {
  id: string;
  clubId: string;
  userId: string;
  role: ClubMemberRole;
  joinedAt: string;
  club?: Club;
  user?: { id: string; fullName: string; role: UserRole; discType: DiscType | null };
}

export interface SystemLog {
  id: string;
  level: LogLevel;
  category: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  isSharedPoolActive: boolean;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface ApiList<T> {
  items: T[];
  total: number;
}
