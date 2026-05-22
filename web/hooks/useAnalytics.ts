'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export type DimKey = 'D' | 'I' | 'S' | 'C';

export type SubDimension = {
  key: DimKey;
  label: string;
  score: number;
  percentile: string;
  description: string;
  strengths: string[];
  growthAreas: string[];
};

export type ComplementaryPersona = {
  idealVector: Record<DimKey, number>;
  label: string;
  rationale: string;
  topDimensions: DimKey[];
  synergies: string[];
};

export type FrictionPoint = {
  dimension: DimKey;
  trigger: string;
  manifestation: string;
  severity: 'Yüksek' | 'Orta' | 'Düşük';
  mitigation: string;
};

export type FrictionMatrix = {
  selfExtremes: FrictionPoint[];
  partnerClashes: Array<{
    partnerDim: DimKey;
    clashDescription: string;
    severity: 'Yüksek' | 'Orta' | 'Düşük';
  }>;
  overallRisk: 'Yüksek' | 'Orta' | 'Düşük';
};

export type RoleAlignment = {
  leadershipScore: number;
  executionScore: number;
  facilitationScore: number;
  primaryRole: 'Lider' | 'Uzman/Uygulayıcı' | 'Koordinatör/Kolaylaştırıcı';
  secondaryRole: string;
  roleDescription: string;
  suitablePositions: string[];
};

export type DiscVector = {
  D: number; I: number; S: number; C: number; confidence: number;
};

export type FullAnalyticsProfile = {
  userId: string;
  discVector: DiscVector;
  dominantType: DimKey;
  subDimensions: SubDimension[];
  complementaryPersona: ComplementaryPersona;
  frictionMatrix: FrictionMatrix;
  roleAlignment: RoleAlignment;
  compositeInsight: string;
};

export function useAnalytics(userId: string) {
  return useQuery<FullAnalyticsProfile>({
    queryKey: ['analytics', userId],
    queryFn: async () => {
      const res = await api.get<FullAnalyticsProfile>(`/api/analytics/${userId}`);
      return res.data;
    },
    enabled: !!userId,
  });
}

export function usePatchSelfProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.patch(`/api/users/${userId}/self-profile`, data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', userId] });
      toast.success('Profil güncellendi.');
    },
    onError: () => toast.error('Güncelleme başarısız.'),
  });
}
