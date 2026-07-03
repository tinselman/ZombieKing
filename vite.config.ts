import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
  },
})
