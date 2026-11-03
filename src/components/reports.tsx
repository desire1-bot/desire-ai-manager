import { ArrowUpRight, CircleDollarSign, Users } from "lucide-react"
import { ContactStatusChart, PipelineChart } from "@/components/report-charts"

const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
const stageLabels: Record<string, string> = { qualification: "Квалификация", proposal: "Предложение", negotiation: "Переговоры", won: "Выиграно", lost: "Закрыто" }
const contactLabels: Record<string, string> = { lead: "Новые", active: "Активные", customer: "Клиенты" }

export function Reports({ data }: { data: { pipeline: { stage: string; amount: number; total: number }[]; contactStatuses: { status: string; total: number }[]; totalDeals: number } }) {
  const pipelineTotal = data.pipeline.reduce((total, item) => total + item.amount, 0)
  const closedValue = data.pipeline.filter((item) => item.stage === "won").reduce((total, item) => total + item.amount, 0)
  const contactsTotal = data.contactStatuses.reduce((total, item) => total + item.total, 0)
  const pipelineChartData = data.pipeline.map((item) => ({ ...item, label: stageLabels[item.stage] ?? item.stage }))
  const contactChartData = data.contactStatuses.map((item) => ({ ...item, label: contactLabels[item.status] ?? item.status }))

  return <>
    <section className="page-heading"><div><span className="eyebrow">АНАЛИТИКА</span><h1>Отчёты</h1><p>Понятная картина воронки и клиентской базы — на основе ваших данных.</p></div></section>
    <section className="report-summary-grid" aria-label="Итоговые показатели">
      <article className="report-summary-card"><span className="summary-icon"><CircleDollarSign aria-hidden="true" /></span><span className="metric-label">Объём воронки</span><strong>{currency.format(pipelineTotal)}</strong><span>по {data.totalDeals} сделкам</span></article>
      <article className="report-summary-card"><span className="summary-icon summary-icon-lime"><ArrowUpRight aria-hidden="true" /></span><span className="metric-label">Выиграно</span><strong>{currency.format(closedValue)}</strong><span>закрытая выручка</span></article>
      <article className="report-summary-card"><span className="summary-icon summary-icon-blue"><Users aria-hidden="true" /></span><span className="metric-label">Контакты</span><strong>{contactsTotal}</strong><span>во всех статусах</span></article>
    </section>
    <div className="report-grid">
      <section className="card">
        <div className="card-heading"><div><h2>Сделки по этапам</h2><p>Количество и сумма</p></div><CircleDollarSign aria-hidden="true" className="report-heading-icon" /></div>
        {data.pipeline.length ? <PipelineChart data={pipelineChartData} /> : <EmptyReport />}
      </section>
      <section className="card">
        <div className="card-heading"><div><h2>Клиентская база</h2><p>Контакты по статусам</p></div><Users aria-hidden="true" className="report-heading-icon" /></div>
        {data.contactStatuses.length ? <ContactStatusChart data={contactChartData} /> : <EmptyReport />}
      </section>
    </div>
  </>
}

function EmptyReport() {
  return <div className="empty-state"><div><strong>Недостаточно данных</strong><span>Добавьте контакты или сделки, чтобы отчёты заполнились.</span></div></div>
}
