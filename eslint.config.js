import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
    js.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                exports: 'writable',
                module: 'writable',
                require: 'readonly',
                global: 'readonly',
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                performance: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': typescript,
        },
        rules: {
            indent: 'off', // Temporarily disabled due to many issues
            'linebreak-style': ['error', 'unix'],
            quotes: ['warn', 'single'],
            semi: ['warn', 'always'],
            'no-dupe-keys': 'warn',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-empty-function': 'off',
            'no-console': [
                'warn',
                {
                    allow: ['warn', 'error', 'info'],
                },
            ],
            'no-debugger': 'error',
            'no-unused-vars': 'off', // Use TypeScript's version instead
            'no-undef': 'off', // TypeScript handles this
        },
    },
    {
        ignores: ['dist/', 'node_modules/', 'coverage/', '*.config.js', '*.config.ts', 'build/'],
    },
];
