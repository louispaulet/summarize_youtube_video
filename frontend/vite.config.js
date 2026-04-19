/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const githubPagesBasePath = '/summarize_youtube_video/'
const localWorkerTarget = 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base =
    env.VITE_BASE_PATH || (command === 'build' ? githubPagesBasePath : '/')

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: localWorkerTarget,
          changeOrigin: true,
        },
        '/health': {
          target: localWorkerTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
    },
    base,
  }
})
