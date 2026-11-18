import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The engine runs in its own process so UI load can never delay light output.
          engine: resolve(__dirname, 'src/engine/process.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
