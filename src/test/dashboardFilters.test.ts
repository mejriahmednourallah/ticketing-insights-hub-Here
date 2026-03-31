import { applyDashboardFilters, defaultFilters, emptyFilters } from '@/lib/dashboardFilters';
import { parseCSV, Ticket } from '@/lib/parseTickets';
import { describe, expect, it } from 'vitest';

describe('dashboard filters', () => {
  it('parses alias-based dataset columns for all filterable fields', () => {
    const csv = [
      'id;project_name;tracker;status;priority;subject;author;assigne_a;created_date;closed_date;resolved_date;equipe_affectee;technology_used;type;csat_score;source;has_attachment;channel;customer_segment;region;reopened;sla_plan',
      '1;Projet A;Bug;Ouvert;Critique;Sujet A;Alice;Bob;30/03/2026;31/03/2026;31/03/2026;Support;WordPress;Incident;5;Email;Oui;Téléphone;VIP;Nord;Oui;Gold',
      '2;Projet B;Task;Résolu;Normale;Sujet B;Charly;Diane;29/03/2026;;;Produit;Drupal;Demande;2;Web;Non;Chat;PME;Sud;Non;Silver',
    ].join('\n');

    const tickets = parseCSV(csv);

    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toMatchObject({
      project: 'Projet A',
      tracker: 'Bug',
      status: 'Ouvert',
      priority: 'Critique',
      author: 'Alice',
      assignee: 'Bob',
      team: 'Support',
      technology: 'WordPress',
      type: 'Incident',
      satisfaction: '5',
      source: 'Email',
      canal: 'Téléphone',
      segmentClient: 'VIP',
      region: 'Nord',
      reopened: 'Oui',
      slaPlan: 'Gold',
      hasAttachment: true,
    });
    expect(tickets[1].hasAttachment).toBe(false);
  });

  it('applies any number of active filters with AND logic', () => {
    const tickets: Ticket[] = [
      {
        id: '1', project: 'Projet A', tracker: 'Bug', status: 'Ouvert', priority: 'Critique', subject: 'Sujet A', author: 'Alice', assignee: 'Bob',
        createdDate: new Date(2026, 2, 30), closedDate: null, resolvedDate: null, team: 'Support', technology: 'WordPress', type: 'Incident',
        satisfaction: '5', source: 'Email', fichiers: 'capture.png', hasAttachment: true, canal: 'Téléphone', segmentClient: 'VIP', region: 'Nord', reopened: 'Oui', slaPlan: 'Gold', year: 2026, month: 3,
      },
      {
        id: '2', project: 'Projet A', tracker: 'Bug', status: 'Ouvert', priority: 'Critique', subject: 'Sujet B', author: 'Alice', assignee: 'Bob',
        createdDate: new Date(2026, 2, 29), closedDate: null, resolvedDate: null, team: 'Support', technology: 'WordPress', type: 'Incident',
        satisfaction: '5', source: 'Email', fichiers: '', hasAttachment: false, canal: 'Téléphone', segmentClient: 'VIP', region: 'Nord', reopened: 'Oui', slaPlan: 'Gold', year: 2026, month: 3,
      },
      {
        id: '3', project: 'Projet B', tracker: 'Task', status: 'Résolu', priority: 'Normale', subject: 'Sujet C', author: 'Charly', assignee: 'Diane',
        createdDate: new Date(2026, 2, 28), closedDate: null, resolvedDate: null, team: 'Produit', technology: 'Drupal', type: 'Demande',
        satisfaction: '3', source: 'Web', fichiers: '', hasAttachment: false, canal: 'Chat', segmentClient: 'PME', region: 'Sud', reopened: 'Non', slaPlan: 'Silver', year: 2026, month: 3,
      },
    ];

    const filters = {
      ...emptyFilters,
      project: 'Projet A',
      tracker: 'Bug',
      status: 'Ouvert',
      priority: 'Critique',
      author: 'Alice',
      assignee: 'Bob',
      technology: 'WordPress',
      source: 'Email',
      fichiers: 'Oui',
      canal: 'Téléphone',
      segmentClient: 'VIP',
      region: 'Nord',
      reopened: 'Oui',
      slaPlan: 'Gold',
      dateFrom: '2026-03-30',
      dateTo: '2026-03-30',
    };

    expect(applyDashboardFilters(tickets, filters).map(ticket => ticket.id)).toEqual(['1']);
  });

  it('uses Tout as the default reset state', () => {
    expect(defaultFilters).toEqual(emptyFilters);
  });
});