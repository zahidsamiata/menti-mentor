'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { setPlatformSession } from '@/lib/platformSession';

export default function PlatformLoginPage() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post<{ accessToken: string }>(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/platform/auth`,
        { key },
      );
      setPlatformSession({ accessToken: res.data.accessToken });
      router.replace('/platform');
    } catch {
      setError('Geçersiz platform anahtarı.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 text-white text-3xl mb-4">
            ⚡
          </div>
          <h1 className="text-xl font-bold text-white">Platform Yöneticisi</h1>
          <p className="text-slate-400 text-sm mt-1">Geliştirici kontrol paneli</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Platform Anahtarı
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="current-password"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors"
              required
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <span>⚠</span> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !key}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 text-sm transition-colors"
          >
            {loading ? 'Doğrulanıyor…' : 'Giriş Yap'}
          </button>
        </form>

        <p className="text-center text-slate-600 text-xs mt-6">
          Tenant kullanıcısı mısınız?{' '}
          <a href="/login" className="text-slate-400 hover:text-white transition-colors">
            Normal giriş →
          </a>
        </p>
      </div>
    </div>
  );
}
