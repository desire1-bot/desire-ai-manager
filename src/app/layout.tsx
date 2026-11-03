import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: {
    default: "DESIRE CRM — отношения, которые растут",
    template: "%s | DESIRE CRM",
  },
  description: "DESIRE CRM для контактов, компаний, ручного поиска лидов по первоисточникам, сделок, задач и Telegram-диалогов.",
  applicationName: "DESIRE CRM",
  appleWebApp: { capable: true, title: "DESIRE CRM", statusBarStyle: "default" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f7f4",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
