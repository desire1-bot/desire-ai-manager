import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { auth } from "@/lib/auth"

export default async function CrmLayout({ children }: LayoutProps<"/">) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")
  return <AppShell user={{ name: session.user.name, email: session.user.email }}>{children}</AppShell>
}
