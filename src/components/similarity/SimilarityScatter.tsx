import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { SimilarityResult } from '@/lib/similarity';

interface Props {
  results: SimilarityResult[];
}

export default function SimilarityScatter({ results }: Props) {
  const data = results.slice(0, 200).map(r => ({
    x: Math.round(r.textSimilarity * 100),
    y: Math.round(r.numDistance * 10) / 10,
    z: Math.round(r.combinedScore * 100),
    label: `#${r.idB}`,
  }));

  const getColor = (score: number) => {
    if (score >= 70) return 'hsl(145, 60%, 42%)';
    if (score >= 40) return 'hsl(45, 95%, 55%)';
    return 'hsl(0, 75%, 55%)';
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <h3 className="text-sm font-semibold text-primary">Clusters de similarité</h3>
      <p className="text-xs text-muted-foreground">X = Similarité texte (%), Y = Distance numérique. Couleur = score combiné.</p>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" name="Similarité texte %" type="number" domain={[0, 100]} />
          <YAxis dataKey="y" name="Distance num." type="number" />
          <ZAxis dataKey="z" range={[40, 200]} name="Score combiné" />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded bg-popover border p-2 text-xs shadow-md">
                  <p className="font-medium">{d.label}</p>
                  <p>Texte: {d.x}%</p>
                  <p>Distance: {d.y}</p>
                  <p>Score: {d.z}%</p>
                </div>
              );
            }}
          />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell key={i} fill={getColor(d.z)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
