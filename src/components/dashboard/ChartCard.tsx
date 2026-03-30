import { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div className="rounded-lg border-2 border-accent bg-card overflow-hidden shadow-sm flex flex-col">
      <div className="bg-primary px-4 py-2">
        <h3 className="text-sm font-bold text-primary-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-primary-foreground/80">{subtitle}</p>}
      </div>
      <div className="p-3 flex-1 min-h-[260px]">
        {children}
      </div>
    </div>
  );
}
