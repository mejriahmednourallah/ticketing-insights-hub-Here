# 🚀 Setup Guide - Ticketing Insights Hub with Local Supabase

## Prerequisites

Assurez-vous d'avoir installé:
- **Supabase CLI**: `npm install -g @supabase/cli` or `brew install supabase/tap/supabase`
- **Docker**: https://www.docker.com/products/docker-desktop
- **Bun**: https://bun.sh/

Vérifiez l'installation:
```bash
supabase --version
docker --version
bun --version
```

---

## Quick Start (Copier-coller)

### Option 1: Utiliser le script d'automatisation
```bash
cd /workspaces/ticketing-insights-hub
chmod +x SETUP_MANUAL.sh
./SETUP_MANUAL.sh
```

### Option 2: Étapes manuelles

**1. Démarrer Supabase localement**
```bash
cd /workspaces/ticketing-insights-hub
supabase start --no-verify-jwt-secret
```
⏱️ Première exécution: 2-5 minutes (télécharge les images Docker)

**2. Extraire les credentials locales**
```bash
supabase status -o env > .env.local.tmp
cat .env.local.tmp
# Voyez: API_URL, ANON_KEY, SERVICE_ROLE_KEY
```

**3. Appliquer les migrations**
```bash
supabase db push
```
Cela crée:
- Tables: `redmine_projects`, `redmine_issues`, `sync_state`, `sync_runs`
- Vue: `redmine_ticket_view`
- Extensions: `pg_cron`, `pg_net`
- Fonction: `trigger_redmine_ingest()`
- Cron: `redmine_ingest_every_5m` (chaque 5 minutes)

**4. Créer .env.local.runtime**
```bash
cat > .env.local.runtime <<EOF
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1
SUPABASE_SERVICE_ROLE_KEY=<votre_service_role_key>
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<votre_anon_key>
EOF
```

**5. Injecter les secrets pour la Edge Function**
```bash
supabase secrets set \
  REDMINE_URL=https://maintenance.medianet.tn \
  REDMINE_API_KEY=replace_me \
  REDMINE_PAGE_SIZE=100 \
  SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_SERVICE_ROLE_KEY=<votre_service_role_key> \
  REDMINE_FIELD_TEAM="Equipe Affectée,Equipe Affectee,team" \
  REDMINE_FIELD_TECHNOLOGY="CMS / Framework,technology,technology_used"
```

**6. Déployer la Edge Function**
```bash
supabase functions deploy redmine-ingest --no-verify-jwt
```

**7. Charger les variables d'environnement**
```bash
source .env.local.runtime
```

**8. Démarrer le frontend**
```bash
docker compose up --build
```
L'app est accessible à: **http://localhost:8080**

---

## 🔄 Déclencher une ingestion manuelle

Après le bootstrap, déclenchez la première synchronisation:
```bash
source .env.local.runtime
bun run ingest:redmine:function
```

Réponse attendue (JSON):
```json
{
  "ok": true,
  "projectsFetched": 184,
  "issuesFetched": 12453,
  "issuesUpserted": 12453,
  "startedAt": "2026-04-08T...",
  "endedAt": "2026-04-08T..."
}
```

---

## 📊 Vérifier que les données sont présentes

**Accédez à la base locale:**
```bash
supabase postgres connect --local
```

**Vérifiez les tables:**
```sql
SELECT COUNT(*) as projects FROM redmine_projects;
SELECT COUNT(*) as issues FROM redmine_issues;
SELECT COUNT(*) as syncs FROM sync_runs WHERE status = 'success';
```

---

## 🐛 Troubleshooting

### ❌ `supabase: command not found`
```bash
npm install -g @supabase/cli
```

### ❌ `Docker daemon not running`
Démarrer Docker (Desktop ou via systemctl):
```bash
sudo systemctl start docker
```

### ❌ `supabase start` échoue
Nettoyer les images Docker orphelines:
```bash
docker system prune -a --volumes
supabase start --no-verify-jwt-secret
```

### ❌ `supabase db push` échoue
Vérifier que les migrations existent:
```bash
ls -la supabase/migrations/
# Doit afficher:
#   20260408120000_redmine_pipeline.sql
#   20260408131500_redmine_ingest_cron.sql
```

### ❌ Fonction ne s'exécute pas
Vérifiez les logs:
```bash
supabase functions logs redmine-ingest --local
```

Redéployez:
```bash
supabase functions deploy redmine-ingest --no-verify-jwt
```

### ❌ Cron ne déclenche pas l'ingestion automatiquement
Vérifiez que l'extension est activée:
```bash
supabase postgres connect --local
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
SELECT * FROM cron.job WHERE jobname = 'redmine_ingest_every_5m';
```

---

## 🔌 Architecture

```
Redmine API (https://maintenance.medianet.tn)
        ↓
Supabase Edge Function (redmine-ingest)
        ↓
Supabase PostgreSQL Local (http://127.0.0.1:54321)
        ↓
pg_cron (Déclenche la function toutes les 5 min)
        ↓
Dashboard (http://localhost:8080) via loadTickets()
        ↓ (Supabase → CSV fallback)
Recharts + Analytics UI
```

---

## 📝 Prochaines étapes

Après la configuration:

1. ✅ Vérifier que le Dashboard affiche des données
2. ✅ Tester la Similarity Analysis
3. ✅ Vérifier que les filtres fonctionnent
4. ✅ Envoyer des messages au chat IA
5. Optionnel: Configurer un déploiement cloud Supabase
6. Optionnel: Ajouter un mode sync incrémental (updated_on filtering)

---

## 📞 Support

Si vous avez des problèmes, vérifiez:
- Logs de Supabase: `supabase logs --local`
- Logs de la fonction: `supabase functions logs redmine-ingest --local`
- Logs du frontend: Console du navigateur (F12)
