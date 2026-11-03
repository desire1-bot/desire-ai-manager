import { requireCurrentUser } from "@/lib/crm/queries"

export default async function SettingsPage() {
  const user = await requireCurrentUser()
  const initials = user.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "D"
  return <>
    <section className="page-heading"><div><span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Настройки</h1><p>Данные вашего аккаунта и пространство DESIRE CRM.</p></div></section>
    <section className="card settings-card">
      <div className="card-heading"><div><h2>Аккаунт</h2><p>Управление профилем, с которым вы вошли.</p></div><span className="status-badge" data-status="active">Аккаунт активен</span></div>
      <div className="account-card"><span className="profile-avatar" aria-hidden="true">{initials}</span><div><strong>{user.name}</strong><p>{user.email}</p></div></div>
      <p className="settings-note">Ваши контакты, компании, сделки и задачи доступны только в рамках этого аккаунта.</p>
    </section>
    <section className="card settings-card">
      <div className="card-heading"><div><h2>DESIRE CRM</h2><p>Пространство для отношений, которые растут.</p></div></div>
      <div className="settings-detail"><span>Данные хранятся в защищённой базе проекта</span><strong>Neon Postgres</strong></div>
      <div className="settings-detail"><span>Способ входа</span><strong>Электронная почта и пароль</strong></div>
    </section>
  </>
}
