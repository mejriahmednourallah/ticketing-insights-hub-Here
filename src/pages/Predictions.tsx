import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarRange, Gauge, Sparkles, Tickets } from 'lucide-react';
import {
  PredictionOption,
  PredictionOptionsResponse,
  PredictionScopeType,
  ResolutionDelayPredictionResponse,
  TicketVolumePredictionResponse,
  loadPredictionOptions,
  loadResolutionDelayPrediction,
  loadTicketVolumePrediction,
  loadTicketVolumePredictionOptions,
} from '@/lib/analyticsApi';
import { cn } from '@/lib/utils';

const EMPTY_OPTIONS: PredictionOptionsResponse = {
  projects: [],
  teams: [],
  minimumHistoryMonths: 24,
  minimumResolvedTickets: 120,
  minimumTickets: 120,
  horizonMonths: 6,
};

const monthLabel = (value: string | null | undefined) => {
  if (!value) return 'Mois inconnu';
  const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? '1')))
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Mois inconnu';
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date);
};

function mergeOptions(
  delayOptions: PredictionOption[],
  volumeOptions: PredictionOption[],
): PredictionOption[] {
  const byValue = new Map<string, PredictionOption>();
  [...delayOptions, ...volumeOptions].forEach(option => {
    const existing = byValue.get(option.value);
    byValue.set(option.value, {
      ...existing,
      ...option,
      historyMonths: Math.max(existing?.historyMonths ?? 0, option.historyMonths),
      resolvedTickets: option.resolvedTickets ?? existing?.resolvedTickets,
      tickets: option.tickets ?? existing?.tickets,
    });
  });
  return [...byValue.values()].sort((left, right) => left.value.localeCompare(right.value));
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'teal' }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
  tone?: 'teal' | 'blue' | 'amber' | 'slate' | 'violet';
}) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="executive-card p-5">
      <div className={cn('mb-4 flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function ForecastUnavailableCard({ title, message, detail }: {
  title: string;
  message: string | null;
  detail: string;
}) {
  return (
    <div className="executive-card border-amber-200 bg-amber-50 p-6">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h2 className="font-bold text-amber-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-amber-800">{message || 'Prévision non disponible pour ce périmètre.'}</p>
          <p className="mt-2 text-xs text-amber-700">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function ForecastDictionary() {
  const entries = [
    {
      term: 'Valeur du mois prochain',
      definition: 'Projection du modÃ¨le sÃ©lectionnÃ© pour le premier mois futur complet.',
    },
    {
      term: 'RÃ©fÃ©rence rÃ©cente',
      definition: 'Niveau observÃ© sur les trois derniers mois complets, utilisÃ© comme point de comparaison.',
    },
    {
      term: 'Ã‰volution attendue',
      definition: 'Ã‰cart entre la projection du mois prochain et la rÃ©fÃ©rence rÃ©cente.',
    },
    {
      term: 'FiabilitÃ©',
      definition: 'Lecture simple de lâ€™erreur de backtest : plus lâ€™erreur est faible, plus la prÃ©vision est stable.',
    },
    {
      term: 'Mois en cours',
      definition: 'AffichÃ© pour contexte, mais exclu de lâ€™entraÃ®nement car les donnÃ©es du mois ne sont pas terminÃ©es.',
    },
  ];

  return (
    <section className="executive-card p-5 md:p-6">
      <p className="section-kicker">Dictionnaire de prÃ©vision</p>
      <h2 className="mt-1 text-lg font-bold text-slate-950">Comment lire les valeurs calculÃ©es</h2>
      <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.map(entry => (
          <div key={entry.term} className="border-l-2 border-teal-500 pl-3">
            <dt className="text-sm font-bold text-slate-900">{entry.term}</dt>
            <dd className="mt-1 text-xs leading-5 text-slate-500">{entry.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ForecastChart({ data, unit, rangeLabel }: {
  data: Array<Record<string, unknown>>;
  unit: string;
  rangeLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={380}>
      <ComposedChart data={data}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit={unit} />
        <Tooltip
          contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }}
          formatter={(value: number | number[], name: string) => {
            if (Array.isArray(value)) return [`${value[0]} à ${value[1]}${unit}`, rangeLabel];
            return [`${value}${unit}`, name === 'observed' ? 'Observé' : 'Prévu'];
          }}
        />
        <Legend formatter={value => value === 'observed' ? 'Observé' : value === 'predicted' ? 'Prévu' : rangeLabel} />
        <Area dataKey="range" fill="#99f6e4" stroke="none" fillOpacity={0.45} />
        <Line dataKey="observed" type="monotone" stroke="#0f172a" strokeWidth={2.5} dot={false} connectNulls />
        <Line dataKey="predicted" type="monotone" stroke="#0d9488" strokeWidth={3} strokeDasharray="6 4" dot={{ r: 4 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function Predictions() {
  const [delayOptions, setDelayOptions] = useState(EMPTY_OPTIONS);
  const [volumeOptions, setVolumeOptions] = useState(EMPTY_OPTIONS);
  const [scopeType, setScopeType] = useState<PredictionScopeType>('global');
  const [scopeValue, setScopeValue] = useState('');
  const [delayPrediction, setDelayPrediction] = useState<ResolutionDelayPredictionResponse | null>(null);
  const [volumePrediction, setVolumePrediction] = useState<TicketVolumePredictionResponse | null>(null);
  const [delayError, setDelayError] = useState<string | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingForecasts, setLoadingForecasts] = useState(true);

  useEffect(() => {
    setLoadingOptions(true);
    Promise.all([loadPredictionOptions(), loadTicketVolumePredictionOptions()])
      .then(([nextDelayOptions, nextVolumeOptions]) => {
        setDelayOptions(nextDelayOptions);
        setVolumeOptions(nextVolumeOptions);
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        setDelayError(message);
        setVolumeError(message);
      })
      .finally(() => setLoadingOptions(false));
  }, []);

  useEffect(() => {
    if (scopeType !== 'global' && !scopeValue) {
      setDelayPrediction(null);
      setVolumePrediction(null);
      setDelayError(null);
      setVolumeError(null);
      setLoadingForecasts(false);
      return;
    }

    setLoadingForecasts(true);
    setDelayError(null);
    setVolumeError(null);
    const scope = { type: scopeType, value: scopeValue || undefined };

    Promise.allSettled([
      loadResolutionDelayPrediction(scope),
      loadTicketVolumePrediction(scope),
    ])
      .then(([delayResult, volumeResult]) => {
        if (delayResult.status === 'fulfilled') {
          setDelayPrediction(delayResult.value);
        } else {
          setDelayPrediction(null);
          setDelayError(delayResult.reason instanceof Error ? delayResult.reason.message : String(delayResult.reason));
        }

        if (volumeResult.status === 'fulfilled') {
          setVolumePrediction(volumeResult.value);
        } else {
          setVolumePrediction(null);
          setVolumeError(volumeResult.reason instanceof Error ? volumeResult.reason.message : String(volumeResult.reason));
        }
      })
      .finally(() => setLoadingForecasts(false));
  }, [scopeType, scopeValue]);

  const scopeOptions = useMemo(
    () => scopeType === 'project'
      ? mergeOptions(delayOptions.projects, volumeOptions.projects)
      : mergeOptions(delayOptions.teams, volumeOptions.teams),
    [delayOptions.projects, delayOptions.teams, scopeType, volumeOptions.projects, volumeOptions.teams],
  );

  const delayChartData = useMemo(() => {
    if (!delayPrediction) return [];
    const history = delayPrediction.historical.slice(-24).map(point => ({
      period: point.period,
      label: monthLabel(point.period),
      observed: point.medianDays,
    }));
    const forecast = delayPrediction.forecast.map(point => ({
      period: point.period,
      label: monthLabel(point.period),
      predicted: point.predictedMedianDays,
      range: [point.lowerBoundDays, point.upperBoundDays],
    }));
    return [...history, ...forecast];
  }, [delayPrediction]);

  const volumeChartData = useMemo(() => {
    if (!volumePrediction) return [];
    const history = volumePrediction.historical.slice(-24).map(point => ({
      period: point.period,
      label: monthLabel(point.period),
      observed: point.ticketCount,
    }));
    const forecast = volumePrediction.forecast.map(point => ({
      period: point.period,
      label: monthLabel(point.period),
      predicted: point.predictedTickets,
      range: [point.lowerBoundTickets, point.upperBoundTickets],
    }));
    return [...history, ...forecast];
  }, [volumePrediction]);

  const delayTrendIcon = delayPrediction?.summary.trend === 'improving'
    ? ArrowDownRight
    : delayPrediction?.summary.trend === 'deteriorating'
      ? ArrowUpRight
      : ArrowRight;
  const volumeTrendIcon = volumePrediction?.summary.trend === 'decreasing'
    ? ArrowDownRight
    : volumePrediction?.summary.trend === 'increasing'
      ? ArrowUpRight
      : ArrowRight;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Aide à la décision</p>
          <h1 className="page-title">Prévisions opérationnelles</h1>
          <p className="page-subtitle">
            Projection à six mois du délai médian de résolution et du volume mensuel de nouveaux tickets.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {([
              ['global', 'Global'],
              ['project', 'Projet'],
              ['team', 'Équipe'],
            ] as Array<[PredictionScopeType, string]>).map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-semibold transition',
                  scopeType === type ? 'bg-white text-primary shadow-sm' : 'text-slate-500',
                )}
                onClick={() => {
                  setScopeType(type);
                  setScopeValue('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {scopeType !== 'global' && (
            <select
              aria-label={scopeType === 'project' ? 'Choisir un projet' : 'Choisir une équipe'}
              value={scopeValue}
              onChange={event => setScopeValue(event.target.value)}
              className="min-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none ring-primary/20 focus:ring-4"
            >
              <option value="">Sélectionner…</option>
              {scopeOptions.map(option => (
                <option key={option.value} value={option.value}>{option.value}</option>
              ))}
            </select>
          )}
        </div>
      </section>

      {(loadingOptions || loadingForecasts) && (
        <div className="executive-card flex min-h-[360px] items-center justify-center">
          <div className="text-center">
            <Sparkles className="mx-auto h-8 w-8 animate-pulse text-teal-600" />
            <p className="mt-3 font-semibold text-slate-700">Calcul des prévisions par séries temporelles…</p>
          </div>
        </div>
      )}

      {!loadingOptions && !loadingForecasts && scopeType !== 'global' && !scopeValue && (
        <div className="executive-card p-10 text-center text-slate-500">
          Sélectionnez {scopeType === 'project' ? 'un projet' : 'une équipe'} pour afficher les prévisions.
        </div>
      )}

      {!loadingOptions && !loadingForecasts && (scopeType === 'global' || scopeValue) && (
        <>
          {delayPrediction ? (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Délai attendu le mois prochain"
                  value={`${delayPrediction.summary.nextMonthMedianDays} j`}
                  detail={`Référence récente : ${delayPrediction.summary.recentThreeMonthMedianDays} jours`}
                  icon={CalendarRange}
                  tone="teal"
                />
                <MetricCard
                  label="Moyenne prévue sur six mois"
                  value={`${delayPrediction.summary.sixMonthAverageDays} j`}
                  detail="Moyenne des six valeurs mensuelles projetées"
                  icon={Sparkles}
                  tone="blue"
                />
                <MetricCard
                  label="Évolution attendue"
                  value={`${delayPrediction.summary.changePct > 0 ? '+' : ''}${delayPrediction.summary.changePct}%`}
                  detail={delayPrediction.summary.businessInsight}
                  icon={delayTrendIcon}
                  tone={delayPrediction.summary.trend === 'deteriorating' ? 'amber' : 'teal'}
                />
                <MetricCard
                  label="Fiabilité délai"
                  value={delayPrediction.summary.reliability}
                  detail={`Erreur backtest : ${delayPrediction.model.backtestMaeDays} jours`}
                  icon={Gauge}
                  tone="slate"
                />
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
                <div className="executive-card p-5 md:p-6">
                  <div className="mb-5">
                    <p className="section-kicker">Série temporelle — délais</p>
                    <h2 className="text-lg font-bold text-slate-950">Délai médian de résolution</h2>
                  </div>
                  <ForecastChart data={delayChartData} unit=" j" rangeLabel="Plage probable" />
                </div>

                <div className="space-y-4">
                  <div className="executive-card p-5">
                    <p className="section-kicker">Lecture management</p>
                    <p className="mt-2 text-lg font-bold leading-7 text-slate-950">{delayPrediction.summary.businessInsight}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      Modèle sélectionné après backtest : {delayPrediction.model.name}. Historique : {delayPrediction.model.historyMonths} mois et {delayPrediction.model.resolvedTickets.toLocaleString('fr-FR')} tickets résolus.
                    </p>
                  </div>
                  {delayPrediction.currentMonth && (
                    <div className="executive-card p-5">
                      <p className="section-kicker">Mois en cours — délai</p>
                      <p className="mt-2 text-3xl font-bold text-slate-950">{delayPrediction.currentMonth.medianDays} j</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {delayPrediction.currentMonth.resolvedTickets} tickets déjà résolus. Donnée provisoire, non utilisée pour entraîner la prévision.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <ForecastUnavailableCard
              title="Prévision de délai non disponible"
              message={delayError}
              detail={`Minimum requis : ${delayOptions.minimumHistoryMonths} mois renseignés et ${delayOptions.minimumResolvedTickets ?? 120} tickets résolus.`}
            />
          )}

          {(delayPrediction || volumePrediction) && <ForecastDictionary />}

          {volumePrediction ? (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Tickets attendus le mois prochain"
                  value={volumePrediction.summary.nextMonthTickets.toLocaleString('fr-FR')}
                  detail={`Référence récente : ${volumePrediction.summary.recentThreeMonthAverageTickets} tickets/mois`}
                  icon={Tickets}
                  tone="violet"
                />
                <MetricCard
                  label="Moyenne prévue sur six mois"
                  value={volumePrediction.summary.sixMonthAverageTickets.toLocaleString('fr-FR')}
                  detail="Moyenne des six volumes mensuels projetés"
                  icon={Sparkles}
                  tone="blue"
                />
                <MetricCard
                  label="Évolution du volume"
                  value={`${volumePrediction.summary.changePct > 0 ? '+' : ''}${volumePrediction.summary.changePct}%`}
                  detail={volumePrediction.summary.businessInsight}
                  icon={volumeTrendIcon}
                  tone={volumePrediction.summary.trend === 'increasing' ? 'amber' : 'teal'}
                />
                <MetricCard
                  label="Fiabilité volume"
                  value={volumePrediction.summary.reliability}
                  detail={`Erreur backtest : ${volumePrediction.model.backtestMaeTickets} tickets`}
                  icon={Gauge}
                  tone="slate"
                />
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
                <div className="executive-card p-5 md:p-6">
                  <div className="mb-5">
                    <p className="section-kicker">Série temporelle — tickets</p>
                    <h2 className="text-lg font-bold text-slate-950">Volume mensuel de nouveaux tickets</h2>
                  </div>
                  <ForecastChart data={volumeChartData} unit="" rangeLabel="Plage probable" />
                </div>

                <div className="space-y-4">
                  <div className="executive-card p-5">
                    <p className="section-kicker">Lecture management</p>
                    <p className="mt-2 text-lg font-bold leading-7 text-slate-950">{volumePrediction.summary.businessInsight}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      Modèle sélectionné après backtest : {volumePrediction.model.name}. Historique : {volumePrediction.model.historyMonths} mois et {volumePrediction.model.tickets.toLocaleString('fr-FR')} tickets créés.
                    </p>
                  </div>
                  {volumePrediction.currentMonth && (
                    <div className="executive-card p-5">
                      <p className="section-kicker">Mois en cours — tickets</p>
                      <p className="mt-2 text-3xl font-bold text-slate-950">{volumePrediction.currentMonth.ticketCount.toLocaleString('fr-FR')}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Tickets déjà créés ce mois-ci. Donnée provisoire, non utilisée pour entraîner la prévision.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <section className="executive-card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-bold text-slate-950">Prévision mensuelle des tickets</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Mois</th>
                        <th className="px-5 py-3">Tickets prévus</th>
                        <th className="px-5 py-3">Plage probable à 80%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {volumePrediction.forecast.map(point => (
                        <tr key={point.period}>
                          <td className="px-5 py-4 font-semibold text-slate-900">{monthLabel(point.period)}</td>
                          <td className="px-5 py-4 text-slate-700">{point.predictedTickets.toLocaleString('fr-FR')}</td>
                          <td className="px-5 py-4 text-slate-500">{point.lowerBoundTickets.toLocaleString('fr-FR')} à {point.upperBoundTickets.toLocaleString('fr-FR')} tickets</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <ForecastUnavailableCard
              title="Prévision de volume non disponible"
              message={volumeError}
              detail={`Minimum requis : ${volumeOptions.minimumHistoryMonths} mois renseignés et ${volumeOptions.minimumTickets ?? 120} tickets.`}
            />
          )}

          {delayPrediction && (
            <section className="executive-card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-bold text-slate-950">Prévision mensuelle des délais</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Mois</th>
                      <th className="px-5 py-3">Délai médian prévu</th>
                      <th className="px-5 py-3">Plage probable à 80%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {delayPrediction.forecast.map(point => (
                      <tr key={point.period}>
                        <td className="px-5 py-4 font-semibold text-slate-900">{monthLabel(point.period)}</td>
                        <td className="px-5 py-4 text-slate-700">{point.predictedMedianDays} jours</td>
                        <td className="px-5 py-4 text-slate-500">{point.lowerBoundDays} à {point.upperBoundDays} jours</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-center text-xs leading-5 text-slate-400">
            Ces projections sont des indicateurs d’aide à la décision par séries temporelles. Elles ne constituent pas un engagement de niveau de service.
          </p>
        </>
      )}
    </div>
  );
}
