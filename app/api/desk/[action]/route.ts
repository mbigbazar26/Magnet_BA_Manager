import { Prisma } from '@prisma/client';
import { isAuthorized, isSameOrigin } from '@/lib/auth';
import { contact, createGroup, deleteGroup, saveConsentSettings, send, sendGroup, state, submitTemplate, sync } from '@/lib/desk';
import { credentials, DeskError, graph } from '@/lib/meta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{action:string}> };

function reply(data: unknown, status = 200) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
}

function failure(e: unknown) {
  if (e instanceof DeskError) return reply({error:e.message},e.status);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return reply({error:'This entry already exists. Refresh to see its current state.'},409);
    if (e.code === 'P2025') return reply({error:'The selected item no longer exists.'},404);
  }
  return reply({error:'The database is unavailable or could not save this change. Check the PostgreSQL connection and applied migrations.'},503);
}

export async function GET(req: Request, ctx: Context) {
  if (!isAuthorized(req)) return reply({error:'Sign in to continue.'},401);
  if ((await ctx.params).action !== 'state') return reply({error:'Unknown endpoint.'},404);
  try { return reply(await state()); } catch (e) { return failure(e); }
}

export async function POST(req: Request, ctx: Context) {
  if (!isAuthorized(req)) return reply({error:'Sign in to continue.'},401);
  if (!isSameOrigin(req)) return reply({error:'Use the signed-in dashboard to make changes.'},403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({error:'Expected JSON.'},415);
  try {
    const raw = await req.text();
    if (raw.length > 32000) return reply({error:'Request too large.'},413);
    let input;
    try { input = JSON.parse(raw); } catch { return reply({error:'Invalid JSON.'},400); }
    if (!input || Array.isArray(input) || typeof input !== 'object') return reply({error:'Expected a JSON object.'},400);
    switch ((await ctx.params).action) {
      case 'contacts': await contact(input); break;
      case 'groups': await createGroup(input); break;
      case 'delete-group': await deleteGroup(input); break;
      case 'consent-settings': await saveConsentSettings(input); break;
      case 'templates': await submitTemplate(input); break;
      case 'send': await send(input); break;
      case 'send-group': return reply(await sendGroup(input));
      case 'sync': await sync(); break;
      case 'check': {
        const config = credentials();
        const [number, account] = await Promise.all([
          graph<{display_phone_number:string}>(config.phoneNumberId + '?fields=display_phone_number'),
          graph<{name:string}>(config.accountId + '?fields=name'),
        ]);
        return reply({ok:true,phone:number.display_phone_number,account:account.name});
      }
      default: return reply({error:'Unknown endpoint.'},404);
    }
    return reply({ok:true});
  } catch (e) { return failure(e); }
}

