import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "SmartLucky",
  description: "Sistema de Rifas Profissional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}

        {/* SDK do Mercado Pago (identificação do dispositivo / antifraude). */}
        <Script src="https://sdk.mercadopago.com/js/v2" strategy="afterInteractive" />
      </body>
    </html>
  );
}
