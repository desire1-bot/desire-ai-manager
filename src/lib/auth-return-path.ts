const RETURN_PATH_ORIGIN = "https://desire-crm.invalid"

export function getSafeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return "/dashboard"

  try {
    const url = new URL(candidate, RETURN_PATH_ORIGIN)
    if (url.origin !== RETURN_PATH_ORIGIN) return "/dashboard"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/dashboard"
  }
}
