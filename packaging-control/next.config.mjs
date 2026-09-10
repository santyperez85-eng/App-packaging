/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  // Las rutas pasaron a estar en el mismo idioma que la interfaz. Las viejas
  // siguen resolviendo para no romper links ya compartidos.
  async redirects() {
    return [
      { source: "/projects", destination: "/", permanent: false },
      // La lista de productos es la pantalla de inicio, no una seccion aparte.
      { source: "/productos", destination: "/", permanent: false },
      { source: "/projects/:projectId", destination: "/productos/:projectId", permanent: false },
      { source: "/project-items", destination: "/componentes", permanent: false },
      { source: "/project-items/:projectItemId", destination: "/componentes/:projectItemId", permanent: false },
      { source: "/alerts", destination: "/avisos", permanent: false },
      { source: "/review", destination: "/revision", permanent: false }
    ];
  }
};

export default nextConfig;
