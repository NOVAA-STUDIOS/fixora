import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fixora — AI Code Assistant',
  description: 'Fix, explain, and create code instantly with Fixora AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
