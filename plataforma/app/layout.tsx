import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Medidor de trabajo clínico",
  description: "Panel de la medición de impacto: tiempo en el PC y en SAP, escritura, clics, recorridos y esperas, por consultorio, jornada y consulta.",
  icons: { icon: "/icono.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
