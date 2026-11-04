import { timingSafeEqual } from "node:crypto"
import { runDailyLeadHunterSearches } from "@/lib/lead-hunter-search"

export const runtime = "nodejs"
export const maxDuration = 300

function hasValidCronSecret(request: Request) {
  const expected = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization")
  if (!expected || !authorization?.startsWith("Bearer ")) return false
  const supplied = Buffer.from(authorization.slice(7))
  const expectedBytes = Buffer.from(expected)
  return supplied.length === expectedBytes.length && timingSafeEqual(supplied, expectedBytes)
}

export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runDailyLeadHunterSearches()
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error("[lead-hunter-cron] Daily search failed", error)
    return Response.json({ ok: false, error: "Daily lead research did not complete." }, { status: 500 })
  }
}
