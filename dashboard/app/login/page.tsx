'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Account = 'vendedor_melipilla' | 'vendedor_san_felipe' | 'admin';

const ACCOUNT_OPTIONS: { value: Account; label: string; icon: string }[] = [
  { value: 'vendedor_melipilla', label: 'Vendedor Melipilla', icon: '📍' },
  { value: 'vendedor_san_felipe', label: 'Vendedor San Felipe', icon: '🏪' },
  { value: 'admin', label: 'Administrador', icon: '🛡️' },
];

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account>('vendedor_melipilla');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const isAdmin = account === 'admin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, account }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Contraseña incorrecta.');
        setLoading(false);
        return;
      }

      const { token, role: userRole, sucursal } = await res.json();

      // Guarda el token como cookie persistente (sesión hasta cerrar sesión)
      document.cookie = `jfnn_auth=${token}; path=/; SameSite=Lax`;

      // localStorage para acceso rápido desde componentes
      localStorage.setItem('jfnn_role', userRole);
      localStorage.setItem('jfnn_sucursal', sucursal ?? '');
      localStorage.setItem('jfnn_token', token);

      router.push('/');
      router.refresh();
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
      setLoading(false);
    }
  };

  const selectedOption = ACCOUNT_OPTIONS.find(o => o.value === account)!;

  return (
    <div style={styles.container}>
      {/* Fondo animado */}
      <div style={styles.bg} />
      <div style={styles.bgGlow1} />
      <div style={styles.bgGlow2} />

      <div style={styles.card}>
        {/* Logo / Header */}
        <div style={styles.header}>
          <div style={styles.logoBox}>
            <span style={styles.logoIcon}>🔧</span>
          </div>
          <h1 style={styles.title}>JFNN Omnicanal</h1>
          <p style={styles.subtitle}>Sistema de Ventas y Cotizaciones</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Selector de cuenta — 3 opciones */}
          <div style={styles.roleSelector}>
            {ACCOUNT_OPTIONS.map(opt => {
              const isActive = account === opt.value;
              const activeStyle = opt.value === 'admin' ? styles.roleBtnActiveAdmin : styles.roleBtnActive;
              return (
                <button
                  key={opt.value}
                  type="button"
                  style={{
                    ...styles.roleBtn,
                    ...(isActive ? activeStyle : {}),
                  }}
                  onClick={() => setAccount(opt.value)}
                >
                  {opt.icon} {opt.label}
                </button>
              );
            })}
          </div>

          {/* Campo de contraseña */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Contraseña — {selectedOption.label}</label>
            <div style={styles.inputWrapper}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                style={styles.eyeBtn}
                tabIndex={-1}
              >
                {showPwd ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* Botón submit */}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              ...styles.submitBtn,
              ...(isAdmin ? styles.submitBtnAdmin : {}),
              opacity: loading || !password ? 0.6 : 1,
              cursor: loading || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <span style={styles.spinner}>⟳</span>
            ) : (
              `Entrar como ${selectedOption.label}`
            )}
          </button>
        </form>

        <p style={styles.footer}>
          Repuestos JFNN © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

// ── Estilos inline (sin dependencias externas) ────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  bg: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(236,72,153,0.06) 0%, transparent 60%)',
  },
  bgGlow1: {
    position: 'absolute',
    width: '600px',
    height: '600px',
    borderRadius: '50%',
    background: 'rgba(99,102,241,0.04)',
    filter: 'blur(80px)',
    top: '-200px',
    left: '-200px',
  },
  bgGlow2: {
    position: 'absolute',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'rgba(236,72,153,0.04)',
    filter: 'blur(80px)',
    bottom: '-100px',
    right: '-100px',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: '420px',
    margin: '1rem',
    background: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    padding: '2.5rem 2rem',
    boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem',
  },
  logoBox: {
    width: '64px',
    height: '64px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1rem',
    fontSize: '28px',
    boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
  },
  logoIcon: {
    fontSize: '28px',
  },
  title: {
    color: '#ffffff',
    fontSize: '1.5rem',
    fontWeight: '700',
    margin: '0 0 0.25rem',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: '0.85rem',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  roleSelector: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.4rem',
    background: 'rgba(255,255,255,0.04)',
    padding: '4px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  roleBtn: {
    padding: '0.55rem 0.3rem',
    border: 'none',
    borderRadius: '7px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    lineHeight: 1.2,
    textAlign: 'center',
    whiteSpace: 'normal',
  },
  roleBtnActive: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
  },
  roleBtnActiveAdmin: {
    background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    color: '#ffffff',
    boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: '0.82rem',
    fontWeight: '500',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    padding: '0.875rem 3rem 0.875rem 1rem',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '1rem',
    letterSpacing: '0.1em',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
  },
  eyeBtn: {
    position: 'absolute',
    right: '0.75rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '0.25rem',
    opacity: 0.6,
  },
  errorBox: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    color: '#fca5a5',
    fontSize: '0.85rem',
    textAlign: 'center',
  },
  submitBtn: {
    padding: '0.9rem',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
    letterSpacing: '0.01em',
  },
  submitBtnAdmin: {
    background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    boxShadow: '0 4px 20px rgba(239,68,68,0.4)',
  },
  spinner: {
    display: 'inline-block',
    animation: 'spin 1s linear infinite',
    fontSize: '1.2rem',
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.2)',
    fontSize: '0.75rem',
    marginTop: '1.5rem',
    marginBottom: 0,
  },
};
