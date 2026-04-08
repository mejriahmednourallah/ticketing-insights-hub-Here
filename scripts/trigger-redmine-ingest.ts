const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL?.trim();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const base = (SUPABASE_FUNCTIONS_URL && SUPABASE_FUNCTIONS_URL.length > 0)
    ? SUPABASE_FUNCTIONS_URL.replace(/\/$/, '')
    : `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

  const url = `${base}/redmine-ingest`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'full' }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Ingest trigger failed (${res.status}): ${body}`);
  }

  console.log(body || 'redmine-ingest triggered');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
