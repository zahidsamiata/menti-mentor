'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { publicApi } from '@/lib/api';
import { setSession } from '@/lib/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

const LoginSchema = z.object({
  tenantSlug: z.string().min(1, 'Kuruluş kodu zorunlu'),
  userId: z.string().min(5, 'Kullanıcı ID en az 5 karakter'),
});

interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: { id: string; tenantId: string; role: 'ADMIN' | 'MENTOR' | 'MENTI'; fullName: string; email: string };
  tenant: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null };
}

export default function LoginPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState('');
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = LoginSchema.safeParse({ tenantSlug, userId });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const resp = await publicApi.post<LoginResponse>('/api/auth/login', {
        slug: tenantSlug.trim(),
        userId: userId.trim(),
      });

      const { accessToken, user, tenant } = resp.data;

      setSession({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        fullName: user.fullName,
        accessToken,
        tenantName: tenant.name,
        tenantLogoUrl: tenant.logoUrl,
        tenantPrimaryColor: tenant.primaryColor,
      });

      const dest =
        user.role === 'ADMIN' ? '/dashboard/admin'
        : user.role === 'MENTOR' ? '/dashboard/mentor'
        : '/dashboard/menti';
      router.replace(dest);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { message?: string } } };
        setError(axiosErr.response?.data?.message ?? 'Giriş başarısız.');
      } else {
        setError('Bağlantı hatası. Backend\'in çalıştığından emin olun.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand mark */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white text-xl font-bold mb-3">M</div>
          <h1 className="text-2xl font-bold text-slate-900">Menti-Mentor</h1>
          <p className="text-sm text-slate-500 mt-1">Mentor-Menti Eşleşme Platformu</p>
        </div>

        <Card className="shadow-lg border-0 bg-white/80 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Giriş Yap</CardTitle>
            <CardDescription>Kuruluş kodunuzu ve kullanıcı ID'nizi girin</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tenantSlug">Kuruluş Kodu</Label>
                <Input
                  id="tenantSlug"
                  placeholder="uluslararasi-genc-dernegi"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  autoComplete="organization"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userId">Kullanıcı ID</Label>
                <Input
                  id="userId"
                  placeholder="cmpe3fmh20003v230..."
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  autoComplete="off"
                  className="font-mono text-sm"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                {loading ? 'Giriş yapılıyor...' : 'Giriş Yap →'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-400">
          JWT ile güvenli kimlik doğrulama
        </p>
      </div>
    </div>
  );
}
