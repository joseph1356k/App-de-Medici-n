import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js abre sockets: se queda fuera del bundle del servidor.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,

  // El menú dice «Configuración» y el enlace es /configuracion, pero el navegador
  // autocompleta lo que se ve: nueve 404 en un día, todos a /configuraci%C3%B3n. Que la
  // dirección con tilde lleve al mismo sitio en vez de a una página de error.
  //
  // /turnos era la v1 (turno = médico en un PC). La unidad ahora es la jornada del
  // consultorio; los marcadores viejos aterrizan en la lista de jornadas.
  async redirects() {
    return [
      { source: "/configuración", destination: "/configuracion", permanent: true },
      { source: "/comparación", destination: "/comparacion", permanent: true },
      { source: "/turnos", destination: "/jornadas", permanent: true },
      { source: "/turnos/:id", destination: "/jornadas", permanent: true },
    ];
  },
};

export default nextConfig;
