import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js abre sockets: se queda fuera del bundle del servidor.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default nextConfig;
