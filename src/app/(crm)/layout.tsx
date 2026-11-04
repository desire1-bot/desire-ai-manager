import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { auth } from "@/lib/auth"

export default async function CrmLayout({ children }: LayoutProps<"/">) {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) {
    const requestedPath = requestHeaders.get("x-desire-request-path") ?? "/dashboard"
    const safePath = requestedPath.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/dashboard"
    redirect(`/sign-in?returnTo=${encodeURIComponent(safePath)}`)
  }
  return <AppShell user={{ name: session.user.name, email: session.user.email }}>{children}</AppShell>
}
