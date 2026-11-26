// Keep credentials and all Graph calls inside server route handlers.
export class DeskError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function setup() {
  return {
    accountId: process.env.META_ACCOUNT_ID?.trim() || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID?.trim() || '',
    version: process.env.META_GRAPH_VERSION?.trim() || 'v25.0',
    hasToken: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
    hasAppSecret: Boolean(process.env.META_APP_SECRET?.trim()),
    hasVerifyToken: Boolean(process.env.META_VERIFY_TOKEN?.trim()),
  };
}

export function credentials() {
  const s = setup();
  if (!s.hasToken || !/^\d+$/.test(s.phoneNumberId) || !/^\d+$/.test(s.accountId) || !/^v\d+\.\d+$/.test(s.version)) {
    throw new DeskError('Set your Meta token, account ID, phone number ID and Graph version in .env, then restart the app.', 503);
  }
  return s;
}

export class GraphError extends DeskError {
  constructor(message: string, public uncertain: boolean) { super(message, 502); }
}

export async function graph<T>(path: string, body?: object): Promise<T> {
  const config = credentials();
  const token = process.env.META_ACCESS_TOKEN!.trim();
  let response: Response;
  try {
    response = await fetch('https://graph.facebook.com/' + config.version + '/' + path, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GraphError('Meta could not be reached or the request timed out.', true);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    const detail = String(data?.error?.message || 'Request rejected.').replaceAll(token, '[redacted]').slice(0, 500);
    throw new GraphError('Meta ' + (data?.error?.code ?? response.status) + ': ' + detail, response.status >= 500);
  }
  if (!data) throw new GraphError('Meta returned an unreadable response.', true);
  return data as T;
}

