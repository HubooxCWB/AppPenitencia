import fs from 'node:fs';

const envLines = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(Boolean);
const env = {};
for (const line of envLines) {
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  const key = line.slice(0, idx);
  const raw = line.slice(idx + 1).trim();
  env[key] = raw.replace(/^"|"$/g, '');
}

const url = env.VITE_SUPABASE_URL;
const apikey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !apikey) {
  console.error('Missing env vars');
  process.exit(1);
}

const headers = {
  apikey,
  'Content-Type': 'application/json',
};

const countCompletions = (ranges) => ranges.reduce(
  (acc, range) => acc + (range.peaks ?? []).reduce((peakAcc, peak) => peakAcc + (peak.completions ?? []).length, 0),
  0,
);

const readResp = await fetch(`${url}/rest/v1/rpc/get_snapshot`, {
  method: 'POST',
  headers,
  body: '{}',
});

console.log('GET_STATUS', readResp.status);
const readText = await readResp.text();
if (!readResp.ok) {
  console.log('GET_BODY', readText.slice(0, 400));
  process.exit(0);
}

const ranges = JSON.parse(readText);
console.log('RANGES', ranges.length);
console.log('COMPLETIONS', countCompletions(ranges));

const writeResp = await fetch(`${url}/rest/v1/rpc/replace_snapshot`, {
  method: 'POST',
  headers: {
    ...headers,
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ payload: ranges }),
});

const writeText = await writeResp.text();
console.log('SAVE_STATUS', writeResp.status);
if (writeText) {
  console.log('SAVE_BODY', writeText.slice(0, 400));
}
