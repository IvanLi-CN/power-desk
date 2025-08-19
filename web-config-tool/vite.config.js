import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 开发服务器配置
  server: {
    port: 25085,
    host: true,
    cors: true,
    proxy: {
      // 代理到 Bun API 服务器
      '/api': {
        target: 'http://localhost:25086',
        changeOrigin: true,
        secure: false
      },
      // 代理下载请求到 Bun API 服务器
      '/download': {
        target: 'http://localhost:25086',
        changeOrigin: true,
        secure: false
      }
    }
  },
  
  // 构建配置
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      input: './index.html',
      output: {
        manualChunks: {
          // 将 esptool-js 单独打包
          esptool: ['esptool-js']
        }
      }
    }
  },

  // 优化配置
  optimizeDeps: {
    include: ['esptool-js']
  },
  
  // 静态资源处理
  assetsInclude: ['**/*.bin'],
  
  // 插件配置
  plugins: [
    tailwindcss()
  ]
})
