'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { RankedMenti } from '@/types/api';
import { toast } from 'sonner';

export function useCandidates(mentorId: string) {
  return useQuery({
    queryKey: ['candidates', mentorId],
    queryFn: async () => {
      const res = await api.get<RankedMenti[]>(`/api/mentors/${mentorId}/candidates`);
      return res.data;
    },
    enabled: !!mentorId,
  });
}

export function useSetVisibilityOptIn(mentorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mentiId, status }: { mentiId: string; status: 'APPROVED' | 'REJECTED' }) => {
      const res = await api.post(`/api/mentors/${mentorId}/visibility-optin`, { mentiId, status });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates', mentorId] });
      toast.success('Opt-in durumu güncellendi. Ice-breaker oluşturuluyor...');
    },
    onError: () => toast.error('Opt-in işlemi başarısız.'),
  });
}
