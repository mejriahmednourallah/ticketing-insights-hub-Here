import { useState } from 'react';
import { BarChart3, LogOut, Menu, Search, TrendingUp, X } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuthSession } from '@/components/AuthGate';
import { cn } from '@/lib/utils';

const navigation = [
  { to: '/', label: 'Vue d’ensemble', icon: BarChart3 },
  { to: '/similarity', label: 'Cas similaires', icon: Search },
  { to: '/predictions', label: 'Prévisions', icon: TrendingUp },
];

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuthSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 md:px-8">
          <NavLink to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground shadow-sm">
              TI
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-slate-950">Ticketing Insights</span>
              <span className="block text-[11px] font-medium text-slate-500">Pilotage de l’activité support</span>
            </span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {navigation.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 md:flex"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              Déconnexion
            </button>

            <button
              type="button"
              className="rounded-lg border border-slate-200 p-2 text-slate-700 md:hidden"
              onClick={() => setMobileOpen(open => !open)}
              aria-label="Ouvrir la navigation"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
            {navigation.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => cn(
                    'mb-1 flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold',
                    isActive ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
            <button
              type="button"
              className="mt-2 flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setMobileOpen(false);
                logout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Déconnexion
            </button>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
