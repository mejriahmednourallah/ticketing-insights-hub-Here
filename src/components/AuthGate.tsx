import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { LogIn } from 'lucide-react';
import { loginWithRedmine, LoginResponse } from '@/lib/analyticsApi';

type SessionUser = LoginResponse['user'] & { source: LoginResponse['source'] };
type AuthSession = {
  user: SessionUser | null;
  logout: () => void;
};

const STORAGE_KEY = 'ticketing-insights-user';
const AuthSessionContext = createContext<AuthSession | null>(null);
const DEFAULT_AUTH_SESSION: AuthSession = {
  user: null,
  logout: () => undefined,
};

function readSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as SessionUser : null;
  } catch {
    return null;
  }
}

function saveSession(user: SessionUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function useAuthSession() {
  return useContext(AuthSessionContext) ?? DEFAULT_AUTH_SESSION;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUser(readSession());
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await loginWithRedmine(username, password);
      const nextUser = { ...result.user, source: result.source };
      saveSession(nextUser);
      setUser(nextUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  const session = useMemo<AuthSession>(() => ({
    user,
    logout: () => {
      clearSession();
      setUser(null);
      setUsername('');
      setPassword('');
      setError(null);
    },
  }), [user]);

  if (user) return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center">
        <section className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LogIn className="h-5 w-5" />
            </div>
            <p className="section-kicker">Accès Ticketing Insights</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Connexion Redmine</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Utilisez vos identifiants Redmine. Le compte de démonstration est aussi disponible avec demouser / demouser.
            </p>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="block text-sm font-semibold">
              Identifiant
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Mot de passe
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Vérification...' : 'Se connecter'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
