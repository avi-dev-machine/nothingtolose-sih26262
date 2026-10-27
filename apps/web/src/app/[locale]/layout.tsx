import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';
import { Providers } from '@/components/providers';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AICTE Approval Control Tower | SIH26262',
  description: 'National Regulation & Compliance Intelligence Bureau approval workflow and control tower platform',
};

export default function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as any)) {
    notFound();
  }

  return (
    <html lang={locale}>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
