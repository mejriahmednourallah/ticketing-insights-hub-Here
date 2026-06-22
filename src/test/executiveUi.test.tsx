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
    backtestMaeDays: 3.2,
    trainingStart: '2023-01-01',
    trainingEnd: '2026-05-01',
    historyMonths: 41,
    resolvedTickets: 4100,
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
    trainingStart: '2023-01-01',
    trainingEnd: '2026-05-01',
    historyMonths: 41,
    tickets: 5200,
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

    expect(await screen.findByText('Délai attendu le mois prochain')).toBeInTheDocument();
    expect(screen.getByText('24 j')).toBeInTheDocument();
    expect(screen.getByText('Tickets attendus le mois prochain')).toBeInTheDocument();
    expect(screen.getByText('Prévision mensuelle des tickets')).toBeInTheDocument();

    expect(screen.getByText('Dictionnaire de prévision')).toBeInTheDocument();
    expect(screen.getByText('Valeur du mois prochain')).toBeInTheDocument();

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
            differences: ['Projet: A != B'],
            rank: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('Dictionnaire du diagnostic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dictionnaire du diagnostic/i }));
    expect(screen.getByText('Score textuel')).toBeInTheDocument();
    expect(screen.getByText('Distance numérique')).toBeInTheDocument();
  });
});
