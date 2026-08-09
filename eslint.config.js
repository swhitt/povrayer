// Flat ESLint config for the vanilla-ESM sources, JavaScript AND TypeScript.
//
// web/ is migrating to TypeScript, and the .ts files used to be ignored here on
// the grounds that tsc already type-checks them. That was the wrong trade: tsc
// checks TYPES, eslint checks the things a type checker has no opinion about
// (no-self-assign, no-constant-condition, no-fallthrough, unreachable code), and
// it was exactly `no-self-assign` that found a dead `f.pos = f.pos` in turbo.
// Every module converted to .ts would have quietly dropped out of that net, so
// each conversion would have traded lint coverage for type coverage instead of
// gaining both. typescript-eslint is a dev-only dependency and the standard way
// to lint the language, so the honest fix was to add it rather than shrink scope.
//
// Deliberately the SYNTACTIC preset, not the type-aware one: type-aware linting
// would rebuild the whole program on every lint run to re-derive what
// `npm run typecheck:strict` already proves. This keeps eslint fast and leaves
// type truth to tsc, which owns it.
//
// Globals are scoped per directory: web/ runs in the browser, everything else
// (CLI, tooling, test drivers, server) runs in Node. The Playwright test
// drivers in test/browser/ are Node scripts that also embed browser code in
// page.evaluate(() => ...) callbacks, so they get both global sets.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    // Not first-party / not lintable here:
    // - dist/**: emscripten + tsc build output (generated)
    // - web/coi-serviceworker.js: vendored third-party (MIT, pinned)
    // - coverage/**: generated reports
    ignores: [
      'dist/**',
      '_site/**', // assembled deploy output (dist/ + web/, see tools/assemble-site.mjs)
      '_build/**', // compiled web/ TypeScript (see tools/build-web.mjs)
      '.claude/worktrees/**', // agent worktrees: full nested checkouts of this repo
      '.vercel/**', // Vercel CLI local state + prebuilt output
      'node_modules/**',
      'coverage/**',
      '.playwright-cli/**',
      'web/coi-serviceworker.js',
      'src/index.js', // gitignored symlink to the built wrapper (see tools/link-wrapper.mjs)
    ],
  },

  js.configs.recommended,

  // TypeScript sources: web/*.ts and the wrapper. The plugin's own recommended
  // set replaces the base rules it supersedes (no-unused-vars in particular,
  // whose base version cannot see type-only imports or parameter properties).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts'] })),

  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },

  // Browser runtime: the UI/REPL/render-client modules and examples data.
  {
    files: ['web/**/*.js'],
    languageOptions: { globals: globals.browser },
  },

  // povrayer turbo's app code is the one web/ file that is NOT a module:
  // tools/gen-turbo.mjs inlines it into turbo.html's plain <script>, and turbo
  // must open from file://, where module loading is blocked. So an `import` or
  // `export` here would be a SyntaxError on the shipped page. sourceType 'script'
  // is what makes eslint say so now instead of leaving it to the browser.
  {
    files: ['web/turbo-app.js'],
    languageOptions: { sourceType: 'script' },
  },

  // Node runtime: CLI, tooling, the static server, and node:test suites.
  {
    files: ['src/**/*.mjs', 'tools/**/*.mjs', 'test/**/*.mjs', '*.js', '*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Playwright drivers: Node scripts whose page.evaluate() bodies are browser
  // code, so no-undef must know both worlds.
  {
    files: ['test/browser/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
