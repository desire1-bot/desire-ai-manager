"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const amountConfig = { amount: { label: "Сумма сделки", color: "var(--chart-1)" } } satisfies ChartConfig
const countConfig = { total: { label: "Контакты", color: "var(--chart-2)" } } satisfies ChartConfig
const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })

type PipelineChartItem = { label: string; amount: number }
type ContactChartItem = { label: string; total: number }

export function PipelineChart({ data }: { data: PipelineChartItem[] }) {
  return (
    <ChartContainer config={amountConfig} className="chart-frame">
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 4" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
        <Bar dataKey="amount" fill="var(--color-amount)" radius={5} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  )
}

export function ContactStatusChart({ data }: { data: ContactChartItem[] }) {
  return (
    <ChartContainer config={countConfig} className="chart-frame">
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 4" />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={5} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  )
}
