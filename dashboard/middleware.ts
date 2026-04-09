import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'jfnn-secret-fallback-change-in-prod'
);

const PUBLIC_PATHS = ['/login', '/api/auth'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas — no requieren autenticación
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('jfnn_auth')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const response = NextResponse.next();
    // Inyecta el rol como header para que los Server Components lo lean
    response.headers.set('x-user-role', payload.role as string);
    return response;
  } catch {
    // Token inválido o expirado
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete('jfnn_auth');
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Aplica el middleware a TODAS las rutas excepto:
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
