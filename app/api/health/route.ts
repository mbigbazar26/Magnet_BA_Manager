export const dynamic = 'force-dynamic'

// Liveness only: health probes must not continuously wake Neon's free compute.
export function GET() {
  return Response.json({ok: true}, {headers: {'Cache-Control': 'no-store'}})
}
