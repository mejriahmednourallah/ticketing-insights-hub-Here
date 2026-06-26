import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '@/components/AppShell';
import SimilarityResultsSheet from '@/components/similarity/SimilarityResultsSheet';
import { monthLabel } from '@/pages/Dashboard';
import Predictions from '@/pages/Predictions';
import {
  loadPredictionOptions,
  loadResolutionDelayPrediction,
  loadTicketVolumePrediction,
  loadTicketVolumePredictionOptions,
} from '@/lib/analyticsApi';

vi.mock('@/lib/analyticsApi', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/analyticsApi')>();
  return {
    ...actual,
    loadPredictionOptions: vi.fn(),
    loadResolutionDelayPrediction: vi.fn(),
    loadTicketVolumePrediction: vi.fn(),
    loadTicketVolumePredictionOptions: vi.fn(),
  };
});

const options = {
  projects: [{ value: 'Projet A', historyMonths: 36, resolvedTickets: 420, type: 'project' as const }],
  teams: [{ value: 'RUN', historyMonths: 48, resolvedTickets: 900, type: 'team' as const }],
  minimumHistoryMonths: 24,
  minimumResolvedTickets: 120,
  horizonMonths: 6,
};

const volumeOptions = {
  projects: [{ value: 'Projet A', historyMonths: 36, tickets: 520, type: 'project' as const }],
  teams: [{ value: 'RUN', historyMonths: 48, tickets: 980, type: 'team' as const }],
  minimumHistoryMonths: 24,
  minimumTickets: 120,
  horizonMonths: 6,
};

const prediction = {
  scope: { type: 'global' as const, value: null },
  historical: Array.from({ length: 24 }, (_, index) => ({
    period: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
    medianDays: 20 + index / 2,
    resolvedTickets: 100,
  })),
  currentMonth: { period: '2026-06-01', medianDays: 18, resolvedTickets: 42 },
  forecast: Array.from({ length: 6 }, (_, index) => ({
    period: `2026-${String(index + 7).padStart(2, '0')}-01`,
    predictedMedianDays: 24 + index,
    lowerBoundDays: 18 + index,
    upperBoundDays: 31 + index,
  })),
  summary: {
    nextMonthMedianDays: 24,
    sixMonthAverageDays: 26.5,
    recentThreeMonthMedianDays: 25,
    changePct: -4,
    trend: 'stable' as const,
    businessInsight: 'Tendance stable : le délai de résolution devrait rester proche du niveau récent.',
    reliability: 'Élevée' as const,
  },
  model: {
    name: 'damped_holt' as const,
    backtestMaeDays: 100,
    metricsByHorizon: {
      '1': { smape: 0.22, mae: 100, points: 12 },
    },
    trainingStart: '2023-01-01',
    trainingEnd: '2026-05-01',
    historyMonths: 41,
    resolvedTickets: 4100,
  },
  explanation: {
    headline: 'La prévision reste stable parce que le niveau attendu colle au rythme récent.',
    paragraphs: [
      'Le signal principal est une stabilisation du délai de résolution : le prochain mois est attendu à 24 j, contre 25 j sur les trois derniers mois complets.',
      "Le mois en cours reste indicatif seulement : il est affiché pour contexte, mais il n'est pas utilisé pour entraîner la prévision.",
    ],
    evidence: [
      {
        label: 'Écart vs référence récente',
        value: '-4.0%',
        meaning: 'Compare le mois prévu aux trois derniers mois complets.',
      },
    ],
    contributors: [
      {
        dimension: 'project' as const,
        name: 'Projet A',
        metric: 'délai médian',
        recentValue: 24,
        previousValue: 28,
        changePct: -14.3,
        interpretation: 'Projet Projet A tire le délai récent vers le bas.',
      },
    ],
    confidenceNote: "Lecture fiable : les derniers backtests se trompent en moyenne d'environ 3.2 jours.",
  },
};

const volumePrediction = {
  scope: { type: 'global' as const, value: null },
  historical: Array.from({ length: 24 }, (_, index) => ({
    period: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
    ticketCount: 70 + index,
  })),
  currentMonth: { period: '2026-06-01', ticketCount: 34 },
  forecast: Array.from({ length: 6 }, (_, index) => ({
    period: `2026-${String(index + 7).padStart(2, '0')}-01`,
    predictedTickets: 92 + index,
    lowerBoundTickets: 80 + index,
    upperBoundTickets: 105 + index,
  })),
  summary: {
    nextMonthTickets: 92,
    sixMonthAverageTickets: 94.5,
    recentThreeMonthAverageTickets: 88,
    changePct: 4.5,
    trend: 'stable' as const,
    businessInsight: 'Volume stable : le nombre de nouveaux tickets devrait rester proche du niveau récent.',
    reliability: 'Modérée' as const,
  },
  model: {
    name: 'seasonal_naive' as const,
    backtestMaeTickets: 8.4,
    metricsByHorizon: {
      '1': { smape: 0.11, mae: 8.4, points: 12 },
    },
    trainingStart: '2023-01-01',
    trainingEnd: '2026-05-01',
    historyMonths: 41,
    tickets: 5200,
  },
  explanation: {
    headline: 'La prévision reste stable parce que le niveau attendu colle au rythme récent.',
    paragraphs: [
      'Le signal principal est une stabilisation du volume de tickets : le prochain mois est attendu à 92 tickets, contre 88 tickets sur les trois derniers mois complets.',
      "Le mois en cours reste indicatif seulement : il est affiché pour contexte, mais il n'est pas utilisé pour entraîner la prévision.",
    ],
    evidence: [
      {
        label: 'Signal des trois derniers mois',
        value: '+4.5%',
        meaning: 'Compare les trois derniers mois au trimestre précédent.',
      },
    ],
    contributors: [
      {
        dimension: 'team' as const,
        name: 'RUN',
        metric: 'tickets créés',
        recentValue: 92,
        previousValue: 86,
        changePct: 7,
        interpretation: 'Équipe RUN reste proche de son niveau précédent.',
      },
    ],
    confidenceNote: "Lecture à confirmer : l'erreur historique moyenne est d'environ 8.4 tickets.",
  },
};

describe('executive interface', () => {
  beforeEach(() => {
    vi.mocked(loadPredictionOptions).mockResolvedValue(options);
    vi.mocked(loadResolutionDelayPrediction).mockResolvedValue(prediction);
    vi.mocked(loadTicketVolumePredictionOptions).mockResolvedValue(volumeOptions);
    vi.mocked(loadTicketVolumePrediction).mockResolvedValue(volumePrediction);
  });

  it('shows the shared management navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Accueil</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Vue d’ensemble')).toBeInTheDocument();
    expect(screen.getByText('Cas similaires')).toBeInTheDocument();
    expect(screen.getByText('Prévisions')).toBeInTheDocument();
  });

  it('renders forecast KPIs and allows project selection', async () => {
    render(
      <MemoryRouter>
        <Predictions />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Délai prévu')).toBeInTheDocument();
    expect(screen.getByText('24 j')).toBeInTheDocument();
    expect(screen.getByText('Tickets prévus')).toBeInTheDocument();
    expect(screen.getByText('Tendance tickets')).toBeInTheDocument();
    expect(screen.getAllByText('Pourquoi cette prévision ?')).toHaveLength(2);
    expect(screen.getAllByText('Interprétation')).toHaveLength(2);
    expect(screen.getAllByText(/La lecture métier/i)).toHaveLength(2);
    expect(screen.getAllByText(/Testée sur les anciens mois/i)).toHaveLength(2);
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Projet' }));
    fireEvent.change(await screen.findByLabelText('Choisir un projet'), {
      target: { value: 'Projet A' },
    });

    await waitFor(() => {
      expect(loadResolutionDelayPrediction).toHaveBeenLastCalledWith({
        type: 'project',
        value: 'Projet A',
      });
      expect(loadTicketVolumePrediction).toHaveBeenLastCalledWith({
        type: 'project',
        value: 'Projet A',
      });
    });
  });

  it('keeps infrastructure terminology out of public page copy', () => {
    const publicFiles = [
      'src/pages/Dashboard.tsx',
      'src/pages/SimilarityAnalysis.tsx',
      'src/pages/Predictions.tsx',
      'src/components/dashboard/DashboardFilters.tsx',
      'src/components/dashboard/KPICards.tsx',
      'index.html',
    ];
    const content = publicFiles
      .map(file => readFileSync(join(process.cwd(), file), 'utf8'))
      .join('\n');

    expect(content).not.toMatch(/DuckDB|FastAPI|Supabase|warehouse|Not provided/i);
  });

  it('formats dashboard month labels from API-safe date shapes', () => {
    expect(monthLabel('2026-06')).toBe('juin 26');
    expect(monthLabel('2026-06-01')).toBe('juin 26');
    expect(monthLabel('2026-06-01T00:00:00+01:00')).toBe('juin 26');
    expect(monthLabel('bad-period')).toBe('Mois inconnu');
  });

  it('renders the similarity diagnostic dictionary', () => {
    render(
      <SimilarityResultsSheet
        isOpen
        referenceId="100"
        referenceSubject="Ticket source"
        onClose={() => undefined}
        results={[
          {
            idA: '100',
            idB: '101',
            subjectA: 'Ticket source',
            subjectB: 'Ticket proche',
            statusB: 'Clos',
            textSimilarity: 0.7,
            numDistance: 2,
            combinedScore: 0.82,
            similarities: ['Client: même client - Fatales', 'Sujet: similarité texte sujet/description 70%', 'CMS: CMS client - Drupal'],
            differences: [],
            rank: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('Dictionnaire du diagnostic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dictionnaire du diagnostic/i }));
    expect(screen.getByText('Score textuel')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Distance numérique')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /#101/i }));
    expect(screen.getByText('Similarité')).toBeInTheDocument();
    expect(screen.getByText('Client: même client - Fatales')).toBeInTheDocument();
    expect(screen.getByText('CMS: CMS client - Drupal')).toBeInTheDocument();
    expect(screen.queryByText('Différences')).not.toBeInTheDocument();
    expect(screen.queryByText('Projet: A')).not.toBeInTheDocument();
  });
});
