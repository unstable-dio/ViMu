import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        port: 3000,
        open: true, // Automatically open the browser on server start
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    }
})
