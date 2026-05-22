'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { SystemLog, ApiList } from '@/types/api';

export function useSystemLogs(level?: string, category?: string, limit = 50) {
  return useQuery({
    queryKey: ['system-logs', level, category, limit],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit };
      if (level) params.level = level;
      if (category) params.category = category;
      const res = await api.get<ApiList<SystemLog>>('/api/system-logs', { params });
      return res.data;
    },
    refetchInterval: 15_000,
  });
}
