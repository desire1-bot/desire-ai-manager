"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useState } from "react"
import { ArrowRight, Sparkles } from "lucide-react"
import { authClient } from "@/lib/auth-client"

type AuthFormProps = { mode: "sign-in" | "sign-up"; returnTo: string }

export function AuthForm({ mode, returnTo }: AuthFormProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const isSignUp = mode === "sign-up"

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setBusy(true)
    setError("")

    const response = isSignUp
      ? await authClient.signUp.email({
          name: String(formData.get("name") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          password: String(formData.get("password") ?? ""),
        })
      : await authClient.signIn.email({
          email: String(formData.get("email") ?? "").trim(),
          password: String(formData.get("password") ?? ""),
        })

    setBusy(false)
    if (response.error) {
      setError("Не удалось войти. Проверьте данные и попробуйте ещё раз.")
      return
    }
    router.push(returnTo)
    router.refresh()
  }

  return (
    <main className="auth-page">
      <section className="auth-aside">
        <Link href="/sign-in" className="brand-lockup">
          <span className="brand-mark"><Sparkles aria-hidden="true" /></span>
          <span>DESIRE <b>CRM</b></span>
        </Link>
        <div className="auth-aside-copy">
          <span className="eyebrow">ВАШ БИЗНЕС — В ФОКУСЕ</span>
          <h1>От первого контакта до большой сделки.</h1>
          <p>Пространство, где отношения с клиентами становятся сильнее, а работа команды — понятнее.</p>
          <div className="auth-quote"><span>«</span><p>Хорошие отношения начинаются с внимания к деталям.</p></div>
        </div>
        <span className="auth-aside-foot">Простая CRM для растущих команд</span>
      </section>
      <section className="auth-main">
        <div className="auth-form-wrap">
          <span className="eyebrow">{isSignUp ? "НОВОЕ ПРОСТРАНСТВО" : "С ВОЗВРАЩЕНИЕМ"}</span>
          <h2>{isSignUp ? "Создайте аккаунт" : "Войдите в аккаунт"}</h2>
          <p className="auth-intro">{isSignUp ? "Начните собирать все важные отношения в одном месте." : "Продолжайте работу с контактами, сделками и командой."}</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignUp && <label>Ваше имя<input autoComplete="name" name="name" placeholder="Александр Иванов" required /></label>}
            <label>Электронная почта<input autoComplete="email" name="email" type="email" placeholder="name@company.ru" required /></label>
            <label>Пароль<input autoComplete={isSignUp ? "new-password" : "current-password"} name="password" type="password" minLength={8} placeholder="Не менее 8 символов" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? "Подождите…" : isSignUp ? "Создать аккаунт" : "Войти"}<ArrowRight aria-hidden="true" />
            </button>
          </form>
          <p className="auth-switch">
            {isSignUp ? "Уже есть аккаунт? " : "Впервые в DESIRE? "}
            <Link href={`${isSignUp ? "/sign-in" : "/sign-up"}?returnTo=${encodeURIComponent(returnTo)}`}>
              {isSignUp ? "Войти" : "Создать аккаунт"}
            </Link>
          </p>
          <p className="auth-legal">Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности.</p>
        </div>
      </section>
    </main>
  )
}
