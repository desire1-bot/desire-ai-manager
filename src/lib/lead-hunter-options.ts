import type { LeadHunterCategory, LeadHunterCountry } from "@/lib/lead-research-types"

export const leadHunterCategories: { id: LeadHunterCategory; label: string; query: string }[] = [
  { id: "lingerie", label: "Нижнее бельё", query: "производитель бренд нижнего белья официальный сайт" },
  { id: "intimate", label: "Интимные товары", query: "бренд интимных товаров официальный сайт оптовые поставки" },
  { id: "cosmetics", label: "Косметика", query: "российский косметический бренд производитель официальный сайт" },
  { id: "lifestyle", label: "Lifestyle", query: "бренд lifestyle товаров официальный сайт" },
  { id: "gifts", label: "Подарки и магазины", query: "магазин подарков бренд официальный сайт сотрудничество" },
  { id: "events", label: "События и партнёры", query: "организатор мероприятий партнерство спонсорство официальный сайт" },
]

export const leadHunterCountries: { id: LeadHunterCountry; label: string }[] = [
  { id: "RU", label: "Россия" },
  { id: "KZ", label: "Казахстан" },
  { id: "BY", label: "Беларусь" },
  { id: "AM", label: "Армения" },
  { id: "KG", label: "Кыргызстан" },
  { id: "UZ", label: "Узбекистан" },
  { id: "AZ", label: "Азербайджан" },
  { id: "MD", label: "Молдова" },
  { id: "TJ", label: "Таджикистан" },
]
