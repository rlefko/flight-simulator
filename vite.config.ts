import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
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
    server: {
        port: 3000,
        open: true,
    },
    build: {
        target: 'esnext',
        minify: false, // Disable minification for now to avoid errors
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    physics: ['./src/physics'],
                    rendering: ['./src/rendering'],
                    world: ['./src/world'],
                },
            },
        },
    },
    worker: {
        format: 'es',
    },
});
