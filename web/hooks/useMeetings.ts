'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Meeting, Feedback, ApiList } from '@/types/api';
import { toast } from 'sonner';

interface MeetingFilters {
  mentorId?: string;
  mentiId?: string;
  status?: string;
  pendingFeedback?: boolean;
}

export function useMeetings(filters: MeetingFilters = {}) {
  return useQuery({
    queryKey: ['meetings', filters],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filters.mentorId) params.mentorId = filters.mentorId;
      if (filters.mentiId) params.mentiId = filters.mentiId;
      if (filters.status) params.status = filters.status;
      if (filters.pendingFeedback) params.pendingFeedback = 'true';
      const res = await api.get<ApiList<Meeting>>('/api/meetings', { params });
      return res.data;
    },
  });
}

export function useUpdateMeetingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await api.patch<Meeting>(`/api/meetings/${id}`, { status });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      toast.success('Toplantı durumu güncellendi.');
    },
    onError: () => toast.error('Güncelleme başarısız.'),
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { mentorId: string; mentiId: string; scheduledAt: string }) => {
      const res = await api.post<Meeting>('/api/meetings', data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      toast.success('Toplantı talebi oluşturuldu.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Toplantı oluşturulamadı.');
    },
  });
}

export function useMeetingFeedback(meetingId: string) {
  return useQuery({
    queryKey: ['feedback', meetingId],
    queryFn: async () => {
      const res = await api.get<Feedback>(`/api/meetings/${meetingId}/feedback`);
      return res.data;
    },
    enabled: !!meetingId,
    retry: false,
  });
}

export function useSubmitFeedback(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<Feedback>(`/api/meetings/${meetingId}/feedback`, data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      qc.invalidateQueries({ queryKey: ['feedback', meetingId] });
      toast.success('Geri bildirim kaydedildi.');
    },
    onError: () => toast.error('Geri bildirim gönderilemedi.'),
  });
}
