import { NextRequest, NextResponse } from 'next/server';

const ROLE_PATHS: Array<[string, string]> = [
  ['/dashboard/admin', 'ADMIN'],
  ['/dashboard/mentor', 'MENTOR'],
  ['/dashboard/menti', 'MENTI'],
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Platform admin routes ──────────────────────────────────────────────
  if (pathname.startsWith('/platform')) {
    if (pathname === '/platform/login') return NextResponse.next();
    const platformAuth = req.cookies.get('platform_auth')?.value;
    if (platformAuth !== '1') {
      return NextResponse.redirect(new URL('/platform/login', req.url));
    }
    return NextResponse.next();
  }

  // ── Tenant dashboard routes ────────────────────────────────────────────
  if (pathname.startsWith('/dashboard')) {
    const role = req.cookies.get('role')?.value;
    if (!role) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    for (const [path, requiredRole] of ROLE_PATHS) {
      if (pathname.startsWith(path)) {
        if (role !== requiredRole && role !== 'ADMIN') {
          return NextResponse.redirect(new URL('/dashboard', req.url));
        }
        break;
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/platform/:path*'],
};
