import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.ts',
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@physics': path.resolve(__dirname, './src/physics'),
      '@rendering': path.resolve(__dirname, './src/rendering'),
      '@world': path.resolve(__dirname, './src/world'),
      '@aircraft': path.resolve(__dirname, './src/aircraft'),
      '@weather': path.resolve(__dirname, './src/weather'),
      '@controls': path.resolve(__dirname, './src/controls'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@assets': path.resolve(__dirname, './src/assets'),
    },
  },
});