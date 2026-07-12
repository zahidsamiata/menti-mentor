import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Codebase has intentional `as unknown as RequestHandler` casts throughout Express routes
      '@typescript-eslint/no-explicit-any': 'off',
      // Warn (not error) for unused vars; underscore prefix = intentional
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'off',
    },
  },
);
