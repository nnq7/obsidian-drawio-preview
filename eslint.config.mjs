import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  {
    ignores: ['main.js', 'node_modules/**', 'tests/**', 'webapp/**', 'backup/**'],
  },
  ...obsidianmd.configs.recommended,
  {
    // The plugin's recommended config enables type-aware rules; point them at
    // THIS repo's tsconfig (the same one `tsc --noEmit` uses).
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
