'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Club, ClubMembership, ApiList } from '@/types/api';
import { toast } from 'sonner';

export function useClubs() {
  return useQuery({
    queryKey: ['clubs'],
    queryFn: async () => {
      const res = await api.get<ApiList<Club>>('/api/clubs');
      return res.data;
    },
  });
}

export function useClub(id: string) {
  return useQuery({
    queryKey: ['club', id],
    queryFn: async () => {
      const res = await api.get<Club>(`/api/clubs/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useClubMembers(clubId: string) {
  return useQuery({
    queryKey: ['club-members', clubId],
    queryFn: async () => {
      const res = await api.get<ApiList<ClubMembership>>(`/api/clubs/${clubId}/members`);
      return res.data;
    },
    enabled: !!clubId,
  });
}

export function useUserClubs(userId: string) {
  return useQuery({
    queryKey: ['user-clubs', userId],
    queryFn: async () => {
      const res = await api.get<ApiList<ClubMembership>>(`/api/users/${userId}/clubs`);
      return res.data;
    },
    enabled: !!userId,
  });
}

export function useCreateClub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; slug: string; type: string; description?: string }) => {
      const res = await api.post<Club>('/api/clubs', data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clubs'] });
      toast.success('Kulüp oluşturuldu.');
    },
    onError: () => toast.error('Kulüp oluşturulamadı.'),
  });
}

export function useAddClubMember(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { userId: string; role: string }) => {
      const res = await api.post<ClubMembership>(`/api/clubs/${clubId}/members`, data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['club-members', clubId] });
      toast.success('Üye eklendi.');
    },
    onError: () => toast.error('Üye eklenemedi.'),
  });
}

export function useRemoveClubMember(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/api/clubs/${clubId}/members/${userId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['club-members', clubId] });
      toast.success('Üye çıkarıldı.');
    },
    onError: () => toast.error('Üye çıkarılamadı.'),
  });
}
