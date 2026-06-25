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
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  Gauge,
  Sparkles,
  Tickets,
} from 'lucide-react';
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

type ForecastChartRow = {
  period: string;
  label: string;
  observed?: number;
  predicted?: number;
  range?: [number, number];
};

type ForecastNarrative = {
  title: string;
  interpretation: string;
  why: string[];
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

const longMonthLabel = (value: string | null | undefined) => {
  if (!value) return 'date inconnue';
  const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? '1')))
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
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

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function signedPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function accuracyPct(error: number, baseline: number) {
  if (!Number.isFinite(error) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - error / baseline) * 100)));
}

function movementSentence(change: number | null, lowerIsBetter: boolean, metric: string) {
  if (change === null || Math.abs(change) < 5) {
    return `les derniers mois restent proches du rythme précédent sur ${metric}`;
  }
  if (change < 0) {
    return lowerIsBetter
      ? `les derniers mois montrent une amélioration nette sur ${metric}`
      : `les derniers mois montrent un ralentissement sur ${metric}`;
  }
  return lowerIsBetter
    ? `les derniers mois montrent une dégradation sur ${metric}`
    : `les derniers mois montrent une hausse de charge sur ${metric}`;
}

function seasonalSentence(
  historical: Array<{ period: string } & Record<string, string | number>>,
  forecastPeriod: string,
  forecastValue: number,
  valueKey: string,
  unit: string,
) {
  const month = String(forecastPeriod).slice(5, 7);
  const previous = [...historical].reverse().find(point => String(point.period).slice(5, 7) === month);
  if (!previous) return null;

  const previousValue = Number(previous[valueKey]);
  if (!Number.isFinite(previousValue) || previousValue <= 0) return null;

  const change = pctChange(forecastValue, previousValue);
  if (change === null) return null;

  if (Math.abs(change) < 5) {
    return `La saisonnalité confirme ce niveau : le même mois dans l'historique était à ${formatNumber(previousValue, 1)}${unit}, très proche de la projection.`;
  }
  return `La saisonnalité donne un repère utile : le même mois dans l'historique était à ${formatNumber(previousValue, 1)}${unit}, soit ${signedPct(change)} d'écart avec la projection.`;
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

function ForecastChart({ data, unit, rangeLabel }: {
  data: ForecastChartRow[];
  unit: string;
  rangeLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={360}>
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

function NarrativeBlock({ narrative }: { narrative: ForecastNarrative }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="executive-card border-teal-100 bg-teal-50/60 p-5">
        <p className="section-kicker">Interprétation</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">{narrative.title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{narrative.interpretation}</p>
      </section>
      <section className="executive-card p-5">
        <p className="section-kicker">Pourquoi cette prévision ?</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
          {narrative.why.map(item => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </section>
    </div>
  );
}

function buildDelayNarrative(prediction: ResolutionDelayPredictionResponse): ForecastNarrative {
  const historyValues = prediction.historical.map(point => point.medianDays).filter(Number.isFinite);
  const lastThree = historyValues.slice(-3);
  const previousThree = historyValues.slice(-6, -3);
  const recentAverage = average(lastThree);
  const previousAverage = average(previousThree);
  const momentum = pctChange(recentAverage, previousAverage);
  const firstForecast = prediction.forecast[0];
  const accuracy = accuracyPct(prediction.model.backtestMaeDays, prediction.summary.recentThreeMonthMedianDays);
  const seasonal = firstForecast
    ? seasonalSentence(prediction.historical, firstForecast.period, firstForecast.predictedMedianDays, 'medianDays', ' j')
    : null;

  const direction = prediction.summary.changePct <= -5
    ? 'une baisse du délai'
    : prediction.summary.changePct >= 5
      ? 'une hausse du délai'
      : 'un délai globalement stable';

  return {
    title: 'Délai de résolution',
    interpretation: `La lecture métier est ${direction}. Le mois prochain est estimé à ${prediction.summary.nextMonthMedianDays} jours, contre ${prediction.summary.recentThreeMonthMedianDays} jours sur les trois derniers mois complets. Cela donne une variation de ${signedPct(prediction.summary.changePct)}.`,
    why: [
      `La prévision va dans ce sens parce que ${movementSentence(momentum, true, 'les délais')} : ${formatNumber(recentAverage, 1)} j récemment contre ${formatNumber(previousAverage, 1)} j sur les trois mois précédents.`,
      seasonal || `La saisonnalité ne donne pas encore de signal assez net pour ce mois, donc la prévision s'appuie surtout sur le rythme récent.`,
      `Le calcul apprend sur la période ${longMonthLabel(prediction.model.trainingStart)} - ${longMonthLabel(prediction.model.trainingEnd)}, avec ${formatNumber(prediction.model.resolvedTickets)} tickets résolus. Le mois en cours est exclu car il n'est pas terminé.`,
      accuracy === null
        ? `La précision historique n'est pas assez stable pour être résumée en pourcentage simple.`
        : `Testée sur les anciens mois, la prévision atteint environ ${accuracy}% de précision sur ce périmètre.`,
    ],
  };
}

function buildVolumeNarrative(prediction: TicketVolumePredictionResponse): ForecastNarrative {
  const historyValues = prediction.historical.map(point => point.ticketCount).filter(Number.isFinite);
  const lastThree = historyValues.slice(-3);
  const previousThree = historyValues.slice(-6, -3);
  const recentAverage = average(lastThree);
  const previousAverage = average(previousThree);
  const momentum = pctChange(recentAverage, previousAverage);
  const firstForecast = prediction.forecast[0];
  const accuracy = accuracyPct(prediction.model.backtestMaeTickets, prediction.summary.recentThreeMonthAverageTickets);
  const seasonal = firstForecast
    ? seasonalSentence(prediction.historical, firstForecast.period, firstForecast.predictedTickets, 'ticketCount', ' tickets')
    : null;

  const direction = prediction.summary.changePct <= -5
    ? 'une baisse de charge'
    : prediction.summary.changePct >= 5
      ? 'une hausse de charge'
      : 'un volume globalement stable';

  return {
    title: 'Volume de tickets',
    interpretation: `La lecture métier est ${direction}. Le mois prochain est estimé à ${formatNumber(prediction.summary.nextMonthTickets)} tickets, contre ${formatNumber(prediction.summary.recentThreeMonthAverageTickets, 1)} tickets par mois sur les trois derniers mois complets. Cela donne une variation de ${signedPct(prediction.summary.changePct)}.`,
    why: [
      `La prévision va dans ce sens parce que ${movementSentence(momentum, false, 'le volume')} : ${formatNumber(recentAverage, 1)} tickets/mois récemment contre ${formatNumber(previousAverage, 1)} sur les trois mois précédents.`,
      seasonal || `La saisonnalité ne donne pas encore de signal assez net pour ce mois, donc la prévision s'appuie surtout sur le rythme récent.`,
      `Le calcul apprend sur la période ${longMonthLabel(prediction.model.trainingStart)} - ${longMonthLabel(prediction.model.trainingEnd)}, avec ${formatNumber(prediction.model.tickets)} tickets créés. Le mois en cours est exclu car il n'est pas terminé.`,
      accuracy === null
        ? `La précision historique n'est pas assez stable pour être résumée en pourcentage simple.`
        : `Testée sur les anciens mois, la prévision atteint environ ${accuracy}% de précision sur ce périmètre.`,
    ],
  };
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

  const delayChartData = useMemo<ForecastChartRow[]>(() => {
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
      range: [point.lowerBoundDays, point.upperBoundDays] as [number, number],
    }));
    return [...history, ...forecast];
  }, [delayPrediction]);

  const volumeChartData = useMemo<ForecastChartRow[]>(() => {
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
      range: [point.lowerBoundTickets, point.upperBoundTickets] as [number, number],
    }));
    return [...history, ...forecast];
  }, [volumePrediction]);

  const delayNarrative = useMemo(
    () => delayPrediction ? buildDelayNarrative(delayPrediction) : null,
    [delayPrediction],
  );
  const volumeNarrative = useMemo(
    () => volumePrediction ? buildVolumeNarrative(volumePrediction) : null,
    [volumePrediction],
  );

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
              <option value="">Sélectionner...</option>
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
            <p className="mt-3 font-semibold text-slate-700">Calcul des prévisions...</p>
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
          {delayPrediction && delayNarrative ? (
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Délai prévu"
                  value={`${delayPrediction.summary.nextMonthMedianDays} j`}
                  detail="Estimation pour le prochain mois complet"
                  icon={CalendarRange}
                  tone="teal"
                />
                <MetricCard
                  label="Référence récente"
                  value={`${delayPrediction.summary.recentThreeMonthMedianDays} j`}
                  detail="Médiane des trois derniers mois complets"
                  icon={Sparkles}
                  tone="blue"
                />
                <MetricCard
                  label="Évolution"
                  value={signedPct(delayPrediction.summary.changePct)}
                  detail="Écart entre le mois prévu et la référence récente"
                  icon={delayTrendIcon}
                  tone={delayPrediction.summary.trend === 'deteriorating' ? 'amber' : 'teal'}
                />
                <MetricCard
                  label="Précision testée"
                  value={`${accuracyPct(delayPrediction.model.backtestMaeDays, delayPrediction.summary.recentThreeMonthMedianDays) ?? 0}%`}
                  detail="Mesurée sur les anciens mois disponibles"
                  icon={Gauge}
                  tone="slate"
                />
              </div>

              <div className="executive-card p-5 md:p-6">
                <div className="mb-5">
                  <p className="section-kicker">Tendance délai</p>
                  <h2 className="text-lg font-bold text-slate-950">Délai médian de résolution</h2>
                </div>
                <ForecastChart data={delayChartData} unit=" j" rangeLabel="Plage probable" />
              </div>

              <NarrativeBlock narrative={delayNarrative} />
            </section>
          ) : (
            <ForecastUnavailableCard
              title="Prévision de délai non disponible"
              message={delayError}
              detail={`Minimum requis : ${delayOptions.minimumHistoryMonths} mois renseignés et ${delayOptions.minimumResolvedTickets ?? 120} tickets résolus.`}
            />
          )}

          {volumePrediction && volumeNarrative ? (
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Tickets prévus"
                  value={formatNumber(volumePrediction.summary.nextMonthTickets)}
                  detail="Estimation pour le prochain mois complet"
                  icon={Tickets}
                  tone="violet"
                />
                <MetricCard
                  label="Référence récente"
                  value={formatNumber(volumePrediction.summary.recentThreeMonthAverageTickets, 1)}
                  detail="Moyenne des trois derniers mois complets"
                  icon={Sparkles}
                  tone="blue"
                />
                <MetricCard
                  label="Évolution"
                  value={signedPct(volumePrediction.summary.changePct)}
                  detail="Écart entre le mois prévu et la référence récente"
                  icon={volumeTrendIcon}
                  tone={volumePrediction.summary.trend === 'increasing' ? 'amber' : 'teal'}
                />
                <MetricCard
                  label="Précision testée"
                  value={`${accuracyPct(volumePrediction.model.backtestMaeTickets, volumePrediction.summary.recentThreeMonthAverageTickets) ?? 0}%`}
                  detail="Mesurée sur les anciens mois disponibles"
                  icon={Gauge}
                  tone="slate"
                />
              </div>

              <div className="executive-card p-5 md:p-6">
                <div className="mb-5">
                  <p className="section-kicker">Tendance tickets</p>
                  <h2 className="text-lg font-bold text-slate-950">Volume mensuel de nouveaux tickets</h2>
                </div>
                <ForecastChart data={volumeChartData} unit="" rangeLabel="Plage probable" />
              </div>

              <NarrativeBlock narrative={volumeNarrative} />
            </section>
          ) : (
            <ForecastUnavailableCard
              title="Prévision de volume non disponible"
              message={volumeError}
              detail={`Minimum requis : ${volumeOptions.minimumHistoryMonths} mois renseignés et ${volumeOptions.minimumTickets ?? 120} tickets.`}
            />
          )}

          <p className="text-center text-xs leading-5 text-slate-400">
            Ces projections servent à préparer la charge opérationnelle. Elles restent indicatives et doivent être relues avec le contexte métier.
          </p>
        </>
      )}
    </div>
  );
}
