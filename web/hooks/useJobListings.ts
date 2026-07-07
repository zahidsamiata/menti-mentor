'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import type { JobListing, PaginatedList } from '@/types/api';

export interface JobListingFilters {
  isActive?: boolean;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface CreateJobListingPayload {
  title: string;
  description: string;
  location?: string;
  tags?: string[];
}

export interface UpdateJobListingPayload {
  title?: string;
  description?: string;
  location?: string;
  tags?: string[];
  isActive?: boolean;
}

export function useJobListings(filters: JobListingFilters = {}) {
  const params = new URLSearchParams();
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));

  return useQuery<PaginatedList<JobListing>>({
    queryKey: ['job-listings', filters],
    queryFn: async () => {
      const res = await api.get<PaginatedList<JobListing>>(
        `/api/job-listings?${params.toString()}`,
      );
      return res.data;
    },
  });
}

export function useCreateJobListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateJobListingPayload) => {
      const res = await api.post<JobListing>('/api/job-listings', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      toast.success('İlan oluşturuldu.');
    },
    onError: () => toast.error('İlan oluşturulamadı.'),
  });
}

export function useUpdateJobListing(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateJobListingPayload) => {
      const res = await api.patch<JobListing>(`/api/job-listings/${listingId}`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      toast.success('İlan güncellendi.');
    },
    onError: () => toast.error('İlan güncellenemedi.'),
  });
}
