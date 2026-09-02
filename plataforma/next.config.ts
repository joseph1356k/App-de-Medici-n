import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js abre sockets: se queda fuera del bundle del servidor.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,

  // El menú dice «Configuración» y el enlace es /configuracion, pero el navegador
  // autocompleta lo que se ve: nueve 404 en un día, todos a /configuraci%C3%B3n. Que la
  // dirección con tilde lleve al mismo sitio en vez de a una página de error.
  async redirects() {
    return [
      { source: "/configuración", destination: "/configuracion", permanent: true },
      { source: "/comparación", destination: "/comparacion", permanent: true },
    ];
  },
};

export default nextConfig;
