import globals from 'globals';
import noLiteralUiStrings from './eslint-rules/no-literal-ui-strings.js';

// Enforces "French for users, English for code" the structural way: no literal
// string may appear as JSX text or as a user-facing prop value outside
// src/locales/**. This is language-agnostic on purpose — the invariant is
// "every UI string is a lookup", not "no French leaked out", so the app can
// be localized into any language without hunting down strings later.
//
// The built-in react/jsx-no-literals can't distinguish className from
// placeholder — noAttributeStrings is all-attributes-or-none, which floods
// signal with Tailwind class noise. eslint-rules/no-literal-ui-strings.js is
// a small local rule scoped to JSX text plus a curated user-facing attribute
// allowlist instead.
//
// It's a warning repo-wide (there is a pre-existing backlog of hardcoded
// strings predating this rule). CI elevates it to an error for files touched
// in a given PR's diff only — see .github/workflows/deploy.yml — so new code
// is held to the real standard without a giant unrelated cleanup blocking
// every PR today.
export default [
  {
    files: ['src/**/*.jsx'],
    ignores: ['src/**/*.test.jsx'],
    plugins: { local: { rules: { 'no-literal-ui-strings': noLiteralUiStrings } } },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 }
    },
    rules: {
      'local/no-literal-ui-strings': 'warn'
    }
  }
];
