import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // Relative asset paths for the production build so the game works when hosted under
  // a sub-path (e.g. GitHub Pages at /ZombieKing/). Dev server stays at '/'.
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
  },
}))
