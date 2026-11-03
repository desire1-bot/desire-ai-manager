export const dealStageLabels: Record<string, string> = {
  qualification: "Квалификация",
  proposal: "Предложение",
  negotiation: "Переговоры",
  won: "Выиграно",
  lost: "Закрыто",
}

export const contactStatusLabels: Record<string, string> = {
  lead: "Новый контакт",
  active: "Активный",
  customer: "Клиент",
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value)
}

export function formatShortDate(value: string | Date | null) {
  if (!value) return "Без срока"
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(value))
}
