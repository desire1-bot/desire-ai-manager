import Link from "next/link"
import { ArrowDownRight, ArrowRight, ArrowUpRight, Briefcase, CheckCircle2, Users } from "lucide-react"

type DashboardData = Awaited<ReturnType<typeof import("@/lib/crm/queries").getDashboardData>>

const stageLabels: Record<string, string> = {
  qualification: "Квалификация",
  proposal: "Предложение",
  negotiation: "Переговоры",
  won: "Выиграно",
  lost: "Закрыто",
}

const numberFormat = new Intl.NumberFormat("ru-RU")
const currencyFormat = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })

function shortDate(value: string | null) {
  if (!value) return "Без срока"
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(value))
}

export function Overview({ data, name }: { data: DashboardData; name: string }) {
  const maxPipeline = Math.max(...data.pipeline.map((item) => item.amount), 0)
  const firstName = name.trim().split(/\s+/)[0] || "коллега"
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("ru-RU")

  return (
    <>
      <section className="page-heading">
        <div><span className="eyebrow">{today}</span><h1>Добро пожаловать, {firstName}</h1><p>Вот что происходит в вашем рабочем пространстве сегодня.</p></div>
      </section>
      <section className="metric-grid" aria-label="Ключевые показатели">
        <MetricCard label="Контакты" value={numberFormat.format(data.contacts)} note="в вашей базе" tone="var(--pine-soft)" icon={<Users aria-hidden="true" />} />
        <MetricCard label="Активные сделки" value={currencyFormat.format(data.openDealValue)} note="потенциал в работе" tone="#f4eedc" icon={<Briefcase aria-hidden="true" />} />
        <MetricCard label="Компании" value={numberFormat.format(data.companies)} note="в клиентском портфеле" tone="#e7f0f4" icon={<ArrowUpRight aria-hidden="true" />} />
        <MetricCard label="Открытые задачи" value={numberFormat.format(data.activeTasks)} note="на ближайшее время" tone="#f8e9e5" icon={<CheckCircle2 aria-hidden="true" />} />
      </section>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-heading"><div><h2>Воронка продаж</h2><p>Текущая стоимость по этапам</p></div><Link className="section-link" href="/deals">Все сделки <ArrowRight aria-hidden="true" /></Link></div>
          {data.pipeline.length ? (
            <div className="pipeline-list" aria-label="Распределение сделок по этапам">
              {data.pipeline.map((item) => (
                <div className="pipeline-row" key={item.stage}>
                  <span className="pipeline-label">{stageLabels[item.stage] ?? item.stage}</span>
                  <span className="pipeline-track"><span className="pipeline-fill" style={{ width: `${maxPipeline ? Math.max(4, item.amount / maxPipeline * 100) : 0}%` }} /></span>
                  <span className="pipeline-value">{currencyFormat.format(item.amount)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Воронка пока пуста" copy="Добавьте первую сделку, чтобы увидеть движение продаж." href="/deals" link="Создать сделку" />}
        </section>

        <section className="card">
          <div className="card-heading"><div><h2>Ближайшие задачи</h2><p>Что важно не забыть</p></div><Link className="section-link" href="/tasks">Все задачи <ArrowRight aria-hidden="true" /></Link></div>
          {data.upcomingTasks.length ? (
            <div className="list-stack">
              {data.upcomingTasks.map((task) => (
                <div className="list-row" key={task.id}>
                  <div className="list-main"><strong>{task.title}</strong><span>Приоритет: {task.priority === "high" ? "высокий" : task.priority === "low" ? "низкий" : "обычный"}</span></div>
                  <div className="list-trailing"><strong>{shortDate(task.dueDate)}</strong><span>срок</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Задач пока нет" copy="Добавьте напоминание, чтобы ничего не упустить." href="/tasks" link="Открыть задачи" />}
        </section>

        <section className="card dashboard-recent">
          <div className="card-heading"><div><h2>Последние сделки</h2><p>Недавно обновлённые</p></div><Link className="section-link" href="/deals">Перейти <ArrowRight aria-hidden="true" /></Link></div>
          {data.recentDeals.length ? (
            <div className="list-stack">
              {data.recentDeals.map((deal) => (
                <div className="list-row" key={deal.id}>
                  <div className="list-main"><strong>{deal.title}</strong><span>{stageLabels[deal.stage] ?? deal.stage}</span></div>
                  <div className="list-trailing"><strong>{currencyFormat.format(deal.value)}</strong><span>сумма сделки</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Добавьте первую сделку" copy="Следите за этапами и ожидаемой выручкой в одной воронке." href="/deals" link="Создать сделку" />}
        </section>

        <section className="highlight-card">
          <span className="highlight-orbit" aria-hidden="true" /><span className="highlight-icon"><ArrowDownRight aria-hidden="true" /></span>
          <span className="eyebrow">ХОРОШИЙ СТАРТ</span><h2>Сильные отношения строятся на внимании.</h2><p>Добавьте контакты, компании и задачи — DESIRE поможет держать всё важное в поле зрения.</p>
          <Link className="highlight-link" href="/contacts?new=1">Добавить контакт <ArrowRight aria-hidden="true" /></Link>
        </section>
      </div>
    </>
  )
}

function MetricCard({ label, value, note, tone, icon }: { label: string; value: string; note: string; tone: string; icon: React.ReactNode }) {
  return <article className="metric-card" style={{ "--metric-tint": tone } as React.CSSProperties}><div className="metric-card-top"><span className="metric-label">{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value}</strong><span className="metric-note">{note}</span></article>
}

function EmptyState({ title, copy, href, link }: { title: string; copy: string; href: string; link: string }) {
  return <div className="empty-state"><div><strong>{title}</strong><span>{copy}</span><Link className="empty-link" href={href}>{link} <ArrowRight aria-hidden="true" /></Link></div></div>
}
