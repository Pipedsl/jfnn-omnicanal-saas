import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Elimina la cookie de sesión
  response.cookies.set('jfnn_auth', '', {
    expires: new Date(0),
    path: '/',
  });
  return response;
}
