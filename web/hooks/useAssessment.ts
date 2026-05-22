'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export interface Question {
  id: string;
  text: string;
  type: 'CORE' | 'DEEPENING';
  discDimension: 'D' | 'I' | 'S' | 'C' | 'GENERAL';
  order: number;
}

export interface MyProgress {
  answered: number;
  total: number;
  remaining: number;
  completionRate: number;
}

export interface DiscVector {
  D: number; I: number; S: number; C: number;
  confidence: number;
}

export function useQuestions() {
  return useQuery({
    queryKey: ['questions'],
    queryFn: async () => {
      const res = await api.get<{ items: Question[]; total: number }>('/api/questions');
      return res.data;
    },
  });
}

export function useMyProgress() {
  return useQuery({
    queryKey: ['my-progress'],
    queryFn: async () => {
      const res = await api.get<MyProgress>('/api/questions/my-responses');
      return res.data;
    },
  });
}

export function useSubmitResponses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (responses: { questionId: string; value: number }[]) => {
      const res = await api.post<{ message: string; discVector: DiscVector }>(
        '/api/questions/respond',
        { responses },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      const pct = Math.round(data.discVector.confidence * 100);
      toast.success(`Profil güncellendi — Bütünlük: %${pct}`);
    },
    onError: () => toast.error('Yanıtlar kaydedilemedi.'),
  });
}
