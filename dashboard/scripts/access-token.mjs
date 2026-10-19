// Cloudflare Access service token for the scripts that post to the Worker from this laptop.
// Read from .access-token (gitignored, JSON { "clientId", "clientSecret" }); without it, no headers.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.access-token');

export function accessHeaders() {
  if (!existsSync(FILE)) return {};
  const t = JSON.parse(readFileSync(FILE, 'utf8'));
  if (!t.clientId || !t.clientSecret) return {};
  return { 'CF-Access-Client-Id': t.clientId, 'CF-Access-Client-Secret': t.clientSecret };
}
