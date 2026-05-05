import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'jfnn-secret-fallback-change-in-prod'
);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { password, account, role: legacyRole } = body;

  // ── Ruta nueva: body incluye `account` ─────────────────────────────
  if (account) {
    type AccountKey = 'vendedor_melipilla' | 'vendedor_san_felipe' | 'admin';

    const ACCOUNT_CONFIG: Record<AccountKey, {
      envVar: string;
      role: 'vendedor' | 'admin';
      sucursal: string | null;
    }> = {
      vendedor_melipilla: {
        envVar: 'AUTH_VENDEDOR_MELIPILLA_PIN',
        role: 'vendedor',
        sucursal: 'Melipilla',
      },
      vendedor_san_felipe: {
        envVar: 'AUTH_VENDEDOR_SAN_FELIPE_PIN',
        role: 'vendedor',
        sucursal: 'San Felipe',
      },
      admin: {
        envVar: 'AUTH_ADMIN_PIN',
        role: 'admin',
        sucursal: null,
      },
    };

    const config = ACCOUNT_CONFIG[account as AccountKey];
    if (!config) {
      return NextResponse.json({ error: 'Cuenta inválida.' }, { status: 400 });
    }

    const pin = process.env[config.envVar];
    if (!pin) {
      return NextResponse.json(
        { error: 'Configuración incompleta en el servidor.' },
        { status: 500 }
      );
    }

    if (password !== pin) {
      await new Promise(r => setTimeout(r, 500));
      return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
    }

    const token = await new SignJWT({ role: config.role, sucursal: config.sucursal })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(JWT_SECRET);

    return NextResponse.json(
      { token, role: config.role, sucursal: config.sucursal },
      { status: 200 }
    );
  }

  // ── Ruta legada: body trae `role` sin `account` ────────────────────
  // Mantiene compatibilidad mientras el .env de prod no tenga los nuevos PINs.
  const vendedorPin = process.env.AUTH_VENDEDOR_PIN;
  const adminPin = process.env.AUTH_ADMIN_PIN;

  if (!vendedorPin && !adminPin) {
    return NextResponse.json({ error: 'Configuración incompleta en el servidor.' }, { status: 500 });
  }

  let validRole: string | null = null;

  if (legacyRole === 'vendedor' && vendedorPin && password === vendedorPin) {
    validRole = 'vendedor';
  } else if (legacyRole === 'admin' && adminPin && password === adminPin) {
    validRole = 'admin';
  }

  if (!validRole) {
    await new Promise(r => setTimeout(r, 500));
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  }

  // JWT legado sin campo `sucursal` (middleware lo maneja como vacío)
  const token = await new SignJWT({ role: validRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(JWT_SECRET);

  return NextResponse.json({ token, role: validRole, sucursal: null }, { status: 200 });
}
