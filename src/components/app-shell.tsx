"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3,
  Building2,
  Briefcase,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Send,
  Sparkles,
  Target,
  Users,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"

type AppShellProps = {
  children: React.ReactNode
  user: { name: string; email: string }
}

const primaryNav = [
  { href: "/dashboard", label: "Обзор", icon: LayoutDashboard },
  { href: "/contacts", label: "Контакты", icon: Users },
  { href: "/companies", label: "Компании", icon: Building2 },
  { href: "/leads", label: "Поиск лидов", icon: Target },
  { href: "/deals", label: "Сделки", icon: Briefcase },
  { href: "/tasks", label: "Задачи", icon: CheckSquare },
  { href: "/reports", label: "Отчёты", icon: BarChart3 },
  { href: "/telegram", label: "Telegram", icon: Send },
  { href: "/settings", label: "Настройки", icon: Settings },
]

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

function Profile({ user, onSignOut }: { user: AppShellProps["user"]; onSignOut: () => void }) {
  const initials = user.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "D"
  return (
    <div className="profile-line">
      <span className="profile-avatar" aria-hidden="true">{initials}</span>
      <div className="profile-name"><strong>{user.name}</strong><span>{user.email}</span></div>
      <button className="signout-button" type="button" onClick={onSignOut} aria-label="Выйти из аккаунта" title="Выйти">
        <LogOut aria-hidden="true" />
      </button>
    </div>
  )
}

export function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const activePage = primaryNav.find((item) => isActive(pathname, item.href))?.label ?? "DESIRE CRM"

  async function handleSignOut() {
    await authClient.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  const mobileNav = [primaryNav[0], primaryNav[1], primaryNav[3], primaryNav[5]]
  const moreNav = [primaryNav[2], primaryNav[4], primaryNav[6], primaryNav[7], primaryNav[8]]

  return (
    <div className="crm-layout">
      <aside className="sidebar" aria-label="Основная навигация">
        <Link href="/" className="brand-lockup">
          <span className="brand-mark"><Sparkles aria-hidden="true" /></span>
          <span>DESIRE <b>CRM</b></span>
        </Link>
        <nav className="sidebar-nav">
          <p className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>
          {primaryNav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link${isActive(pathname, href) ? " active" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer"><Profile user={user} onSignOut={handleSignOut} /></div>
      </aside>

      <main className="crm-main">
        <header className="topbar">
          <Link href="/" className="mobile-brand" aria-label="DESIRE CRM — обзор">
            <span className="brand-mark"><Sparkles aria-hidden="true" /></span><span>DESIRE CRM</span>
          </Link>
          <span className="topbar-context">Рабочее пространство <span aria-hidden="true">/</span> {activePage}</span>
          <div className="topbar-right">
            <Link href="/contacts?new=1" className="primary-button"><Plus aria-hidden="true" /><span>Новый контакт</span></Link>
          </div>
        </header>
        {children}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
        {mobileNav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`mobile-nav-link${isActive(pathname, href) ? " active" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </Link>
        ))}
        <button type="button" className={`mobile-nav-link${moreOpen ? " active" : ""}`} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-label="Дополнительные разделы">
          <MoreHorizontal aria-hidden="true" /><span>Ещё</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="mobile-more-menu" role="menu">
          {moreNav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} role="menuitem" className="mobile-more-link" onClick={() => setMoreOpen(false)}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
          <button type="button" role="menuitem" className="mobile-more-link" onClick={handleSignOut}><LogOut aria-hidden="true" /><span>Выйти</span></button>
        </div>
      )}
    </div>
  )
}
