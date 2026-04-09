import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'jfnn-secret-fallback-change-in-prod'
);

export async function POST(req: NextRequest) {
  const { password, role } = await req.json();

  const vendedorPin = process.env.AUTH_VENDEDOR_PIN;
  const adminPin = process.env.AUTH_ADMIN_PIN;

  if (!vendedorPin || !adminPin) {
    return NextResponse.json({ error: 'Configuración incompleta en el servidor.' }, { status: 500 });
  }

  let validRole: string | null = null;

  if (role === 'vendedor' && password === vendedorPin) {
    validRole = 'vendedor';
  } else if (role === 'admin' && password === adminPin) {
    validRole = 'admin';
  }

  if (!validRole) {
    // Pequeño delay para evitar ataques de fuerza bruta por timing
    await new Promise(r => setTimeout(r, 500));
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  }

  // Genera JWT sin expiración (sesión permanente hasta cerrar sesión manual)
  const token = await new SignJWT({ role: validRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(JWT_SECRET);

  return NextResponse.json({ token, role: validRole }, { status: 200 });
}
