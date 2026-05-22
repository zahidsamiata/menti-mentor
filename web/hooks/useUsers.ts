'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { User, ApiList } from '@/types/api';
import { toast } from 'sonner';

export function useUsers(role?: string) {
  return useQuery({
    queryKey: ['users', role],
    queryFn: async () => {
      const params = role ? { role } : {};
      const res = await api.get<ApiList<User>>('/api/users', { params });
      return res.data;
    },
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await api.get<User>(`/api/users/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useClearOrientationLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await api.delete(`/api/meetings/orientation-lock/${userId}`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Oryantasyon kilidi kaldırıldı.');
    },
    onError: () => toast.error('Kilit kaldırılamadı.'),
  });
}
