import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = req.cookies.get('role')?.value;
  const userId = req.cookies.get('userId')?.value;

  if (pathname === '/login' || pathname === '/') return NextResponse.next();

  if (!userId) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (pathname.startsWith('/dashboard/admin') && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  if (pathname.startsWith('/dashboard/mentor') && role !== 'MENTOR' && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  if (pathname.startsWith('/dashboard/menti') && role !== 'MENTI' && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
