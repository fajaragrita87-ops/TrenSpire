import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8080'

  return {
    cacheDir: 'node_modules/.vite-trendspire',
    plugins: [react()],
    optimizeDeps: {
      include: ['recharts', 'react-big-calendar', 'date-fns'],
    },
    server: {
      proxy: {
        '/api': apiTarget,
      },
    },
  }
})
