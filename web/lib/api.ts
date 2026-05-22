import axios from 'axios';
import { getSession } from './session';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const session = getSession();
  if (session) {
    // JWT Bearer token — kriptografik imzalı kimlik doğrulama
    config.headers['Authorization'] = `Bearer ${session.accessToken}`;
    config.headers['X-Tenant-Id'] = session.tenantId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;

// Kimlik doğrulama gerektirmeyen istekler (login öncesi)
export const publicApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
});
