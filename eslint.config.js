import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vite/**',
      'apps/reachy/maxim_reachy_app/**',
      'packages/kit/src/facade/schema.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly' } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // The code-split boundary (AGENTS.md § Repo conventions): heavy dashboard viz must
    // never enter the Reachy on-device bundle. `pnpm size:reachy` is the build-time
    // backstop; this catches the mistake in the editor. Kit source (minus viz itself)
    // is covered too — the lean entry must never reach the heavy deps.
    files: ['apps/reachy/ui/**/*.{ts,tsx}', 'packages/kit/src/**/*.{ts,tsx}'],
    ignores: ['packages/kit/src/viz/**'],
    rules: {
      // no-restricted-imports doesn't see dynamic import(); this does.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression > Literal[value=/^(@maxim\\u002Fkit\\u002Fviz|@xyflow|@visx)/]',
          message: 'Heavy viz must not be imported (even dynamically) outside the console shell.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@maxim/kit/viz',
              message:
                'Heavy viz is console-only — the Reachy on-device bundle imports the lean @maxim/kit entry only.',
            },
            {
              name: '@xyflow/react',
              message: 'react-flow must not enter the Reachy on-device bundle.',
            },
          ],
          patterns: [
            {
              group: ['@maxim/kit/viz/*', '@visx/*', '@xyflow/*'],
              message: 'Heavy viz must not enter the Reachy on-device bundle.',
            },
          ],
        },
      ],
    },
  },
)
