import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

// Las dos fuentes se AUTOALOJAN: next/font las descarga al compilar y las sirve con la página,
// así que un PC del hospital sin salida a internet las ve igual, y no hay petición a Google
// desde el navegador de nadie. `display: swap` para que el texto no parpadee en blanco.
const texto = Manrope({ subsets: ["latin"], variable: "--fuente-texto", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--fuente-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Medidor de trabajo clínico",
  description: "Panel de la medición de impacto: tiempo en el PC y en SAP, escritura, clics, recorridos y esperas, por consultorio, jornada y consulta.",
  icons: { icon: "/icono.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${texto.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
