'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getPlatformSession } from '@/lib/platformSession';

function makePlatformApi() {
  const session = getPlatformSession();
  return axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
  });
}

export type PlatformTenantRow = {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  isSharedPoolActive: boolean;
  createdAt: string;
  _count: { users: number; meetings: number };
};

export type PlatformStats = {
  totals: {
    tenants: number;
    users: number;
    mentors: number;
    mentis: number;
    admins: number;
    meetings: number;
    pendingMeetings: number;
    completedMeetings: number;
  };
  tenants: PlatformTenantRow[];
  recentLogs: Array<{
    id: string;
    level: string;
    category: string;
    message: string;
    createdAt: string;
  }>;
};

export type PlatformHealth = {
  status: 'ok' | 'error';
  db: 'connected' | 'disconnected';
  env: string;
  uptime: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  nodeVersion: string;
};

export function usePlatformStats() {
  return useQuery<PlatformStats>({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      const res = await makePlatformApi().get<PlatformStats>('/api/platform/stats');
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function usePlatformHealth() {
  return useQuery<PlatformHealth>({
    queryKey: ['platform-health'],
    queryFn: async () => {
      const res = await makePlatformApi().get<PlatformHealth>('/api/platform/health');
      return res.data;
    },
    refetchInterval: 15_000,
  });
}
