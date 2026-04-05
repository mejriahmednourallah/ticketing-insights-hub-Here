import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { SimilarityResult } from '@/lib/similarity';

interface Props {
  results: SimilarityResult[];
}

export default function SimilarityBarChart({ results }: Props) {
  const data = results.slice(0, 10).map(r => ({
    id: `#${r.idB}`,
    score: Math.round(r.combinedScore * 100),
  }));

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <h3 className="text-sm font-semibold text-primary">Top 10 — Score de similarité</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="id" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => [`${v}%`, 'Score']} />
          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.score >= 70 ? 'hsl(145, 60%, 42%)' : d.score >= 40 ? 'hsl(45, 95%, 55%)' : 'hsl(0, 75%, 55%)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
