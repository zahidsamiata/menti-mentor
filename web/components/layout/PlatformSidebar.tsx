'use client';

import { usePathname, useRouter } from 'next/navigation';
import { clearPlatformSession } from '@/lib/platformSession';

const NAV = [
  { href: '/platform', label: 'Genel Bakış', icon: '⚡', exact: true },
  { href: '/platform/tenants', label: 'Kuruluşlar', icon: '🏢', exact: false },
  { href: '/platform/logs', label: 'Sistem Logları', icon: '📋', exact: false },
];

export default function PlatformSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearPlatformSession();
    router.replace('/platform/login');
  }

  return (
    <aside className="w-56 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-base shrink-0">
            ⚡
          </div>
          <div>
            <p className="text-white text-sm font-bold leading-tight">Platform</p>
            <p className="text-slate-500 text-[10px] leading-tight">Developer Console</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map(({ href, label, icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <a
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span className="text-base">{icon}</span>
              <span className="font-medium">{label}</span>
            </a>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-slate-800 space-y-0.5">
        <a
          href="/dashboard"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-sm transition-colors"
        >
          <span>↗</span>
          <span>Tenant Paneli</span>
        </a>
        <button
          onClick={logout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800 text-sm transition-colors"
        >
          <span>⏏</span>
          <span>Çıkış</span>
        </button>
      </div>
    </aside>
  );
}
