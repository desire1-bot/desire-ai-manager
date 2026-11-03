import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AuthForm } from "@/components/auth-form"
import { auth } from "@/lib/auth"
import { getSafeReturnTo } from "@/lib/auth-return-path"

type SignUpPageProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const [{ returnTo: requestedReturnTo }, requestHeaders] = await Promise.all([searchParams, headers()])
  const returnTo = getSafeReturnTo(requestedReturnTo)
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (session?.user) redirect(returnTo)
  return <AuthForm mode="sign-up" returnTo={returnTo} />
}
