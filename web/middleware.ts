import { NextRequest, NextResponse } from 'next/server';

const ROLE_PATHS: Array<[string, string]> = [
  ['/dashboard/admin', 'ADMIN'],
  ['/dashboard/mentor', 'MENTOR'],
  ['/dashboard/menti', 'MENTI'],
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Platform admin routes
  if (pathname.startsWith('/platform')) {
    if (pathname === '/platform/login') return NextResponse.next();
    const platformAuth = request.cookies.get('platform_auth')?.value;
    if (platformAuth !== '1') {
      return NextResponse.redirect(new URL('/platform/login', request.url));
    }
    return NextResponse.next();
  }

  // Dashboard routes require a role cookie
  if (pathname.startsWith('/dashboard')) {
    const role = request.cookies.get('role')?.value;
    if (!role) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    for (const [path, requiredRole] of ROLE_PATHS) {
      if (pathname.startsWith(path)) {
        if (role !== requiredRole && role !== 'ADMIN') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
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
