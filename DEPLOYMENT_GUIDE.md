# Supabase Deployment Guide - Local Server & Cloud

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React/Vite)                       │
│                    http://localhost:8080                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    loadTickets() abstraction
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
   ┌────▼─────┐                                ┌─────▼─────┐
   │ Supabase  │                                │    CSV    │
   │(Primary)  │  ◄────── Fallback if error    │  Fallback │
   └────┬──────┘                                └───────────┘
        │
   ┌────▼────────────────────────────┐
   │   redmine_ticket_view (SQL)      │
   │   ├─ redmine_projects            │
   │   ├─ redmine_issues              │
   │   ├─ sync_state                  │
   │   └─ sync_runs                   │
   └────┬─────────────────────────────┘
        │
   ┌────▼──────────────────────────────────┐
   │   pg_cron (every 5 minutes)            │
   │   └─ trigger_redmine_ingest() function│
   └────┬───────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────┐
   │  redmine-ingest Edge Function         │
   │  (Deno TypeScript)                    │
   └────┬───────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────┐
   │   Redmine API                         │
   │   https://maintenance.medianet.tn     │
   └───────────────────────────────────────┘
```

---

## 🖥️ Option 1: Local Development (Your Machine)

### Prerequisites
- Docker Desktop or Docker Engine
- Supabase CLI (or use simplified setup without CLI)
- Node.js + Bun

### Quick Setup

```bash
cd /workspaces/ticketing-insights-hub

# Install Supabase CLI (if not using simplified setup)
curl -L -o /tmp/supabase.tar.gz https://github.com/supabase/cli/releases/download/v1.152.0/supabase_1.152.0_linux_x86_64.tar.gz
sudo tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin/
sudo chmod +x /usr/local/bin/supabase

# Follow SETUP_GUIDE.md
./SETUP_MANUAL.sh
```

### Run Locally
```bash
source .env.local.runtime
docker compose up --build
# Frontend at http://localhost:8080
# Postgres at localhost:5432

# Trigger ingest manually
bun run ingest:redmine:function
```

---

## 🌐 Option 2: Cloud Supabase (Easiest for Production)

No local Postgres needed. Use Supabase cloud project.

### Setup

**1. Create Supabase Project**
- Go to https://app.supabase.com
- Create new project
- Note project URL and API keys

**2. Update .env**
```bash
# Use cloud URLs instead of local
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
```

**3. Apply Migrations**
From Supabase dashboard:
- Go to SQL Editor
- Copy content of `supabase/migrations/20260408120000_redmine_pipeline.sql`
- Run in editor
- Repeat for `20260408131500_redmine_ingest_cron.sql`

**4. Deploy Edge Function**
```bash
supabase functions deploy redmine-ingest \
  --project-id=YOUR_PROJECT_ID \
  --no-verify-jwt
```

**5. Set Secrets**
From Supabase dashboard → Project Settings → Secrets:
```
REDMINE_URL = https://maintenance.medianet.tn
REDMINE_API_KEY = 87d2717302449be90768474ec8f55ca669e92b54
SUPABASE_URL = https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <your_service_role_key>
REDMINE_FIELD_TEAM = Equipe Affectée,Equipe Affectee,team
# ... etc (see .env.example)
```

**6. Run Frontend**
```bash
docker compose up --build
# Frontend at http://localhost:8080
```

---

## 🖨️ Option 3: Server Deployment (Fully Local Linux Server)

For a production server where you want everything running locally (no cloud SaaS).

### Architecture
```
┌──────────────────────────────────────┐
│        Linux Server (your VPS)       │
│   ┌──────────────────────────────┐   │
│   │  Docker Network              │   │
│   │  ├─ Postgres 15              │   │
│   │  ├─ Kong (API Gateway)       │   │
│   │  ├─ Vite (Frontend)          │   │
│   │  └─ Custom Cron Background   │   │
│   └──────────────────────────────┘   │
│   Access: https://your-domain.com    │
└──────────────────────────────────────┘
```

### Setup

**Step 1: Prepare Server**
```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose

# Clone repo
git clone https://github.com/Rimenmouhamed/ticketing-insights-hub.git
cd ticketing-insights-hub
git checkout feature/supabase-local-setup
```

**Step 2: Create Server Config**

Create `docker-compose.server.yml`:
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: ticketing_postgres
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: '--locale=C'
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./supabase/migrations:/docker-entrypoint-initdb.d
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ticketing_web
    environment:
      VITE_SUPABASE_URL: http://postgres:5432
      VITE_SUPABASE_PUBLISHABLE_KEY: ${VITE_SUPABASE_PUBLISHABLE_KEY}
      SUPABASE_URL: http://postgres:5432
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
    ports:
      - "80:8080"
      - "443:8080"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - .:/app
    restart: unless-stopped
    command: bun run dev --host 0.0.0.0 --port 8080

  # Simple cron job container
  scheduler:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ticketing_scheduler
    environment:
      REDMINE_URL: ${REDMINE_URL}
      REDMINE_API_KEY: ${REDMINE_API_KEY}
      SUPABASE_URL: http://postgres:5432
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
    depends_on:
      - postgres
    restart: unless-stopped
    entrypoint: |
      sh -c '
        while true; do
          echo "Running ingest at $(date)"
          bun run ingest:redmine:function || true
          sleep 300
        done
      '

volumes:
  postgres_data:
```

**Step 3: Server Environment**
Create `server.env`:
```bash
POSTGRES_PASSWORD=your_secure_password
REDMINE_URL=https://maintenance.medianet.tn
REDMINE_API_KEY=87d2717302449be90768474ec8f55ca669e92b54
SUPABASE_URL=http://localhost:5432
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
VITE_SUPABASE_URL=http://your-domain.com
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

**Step 4: Deploy**
```bash
# Set environment
export $(cat server.env | xargs)

# Start services
docker-compose -f docker-compose.server.yml up -d

# Check logs
docker-compose -f docker-compose.server.yml logs -f web

# Apply migrations (only once)
docker-compose -f docker-compose.server.yml exec postgres psql -U postgres -f /docker-entrypoint-initdb.d/20260408120000_redmine_pipeline.sql
docker-compose -f docker-compose.server.yml exec postgres psql -U postgres -f /docker-entrypoint-initdb.d/20260408131500_redmine_ingest_cron.sql
```

**Step 5: Setup SSL (HTTPS)**
Use Let's Encrypt + Nginx reverse proxy:
```bash
# Install Nginx
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Get SSL cert
sudo certbot certonly --standalone -d your-domain.com

# Configure Nginx to proxy to Docker
# (See nginx-reverse-proxy.conf below)
```

**Step 6: Monitor**
```bash
# Watch logs
docker-compose -f docker-compose.server.yml logs -f

# Check Postgres data
docker-compose -f docker-compose.server.yml exec postgres psql -U postgres -c "SELECT COUNT(*) FROM redmine_issues;"

# Manually trigger ingest
docker-compose -f docker-compose.server.yml exec web bun run ingest:redmine:function
```

---

## 🔄 Comparison: Local vs Cloud vs Server

| Feature | Local Dev | Cloud Supabase | Server |
|---------|-----------|---|--------|
| **Setup Time** | 10-15 min | 5 min | 20-30 min |
| **Cost** | Free | $5-20/mo | $5-20/mo (server) |
| **Maintenance** | Low | Very Low | High |
| **Uptime SLA** | N/A | 99.9% | Manual |
| **Scalability** | Limited | Auto | Manual |
| **Data Sovereignty** | Local | Supabase Cloud | Full Control |
| **SSL/HTTPS** | None | Included | Manual setup |
| **Migration Effort** | Local→Cloud: Easy | N/A | Cloud→Server: Medium |

---

## 🚀 Next Steps

1. **Test locally first** (Option 1) - validate everything works
2. **Use cloud for production** (Option 2) - easiest ops
3. **Self-hosted later** (Option 3) - if you need full control

All approaches use **the same code**. Only environment variables change!

---

## 📝 Files Reference

- **SETUP_GUIDE.md** - Step-by-step local setup
- **SETUP_MANUAL.sh** - Automated local setup
- **docker-compose.yml** - Frontend + local Supabase
- **.env.example** - Environment template
- **supabase/migrations/** - SQL migrations
- **supabase/functions/redmine-ingest/** - Edge Function code

---

## 🔗 Links

- Supabase Docs: https://supabase.com/docs
- Supabase CLI: https://github.com/supabase/cli
- Self-hosted guide: https://supabase.com/docs/guides/hosting/docker

