// Flat ESLint config for the vanilla-ESM sources. No framework, no TypeScript
// linting here: wrapper/src/*.ts is type-checked by `tsc --noEmit` (see the
// pre-commit hook) and only formatted by Prettier, so it is ignored below.
//
// Globals are scoped per directory: web/ runs in the browser, everything else
// (CLI, tooling, test drivers, server) runs in Node. The Playwright test
// drivers in test/browser/ are Node scripts that also embed browser code in
// page.evaluate(() => ...) callbacks, so they get both global sets.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Not first-party / not lintable here:
    // - dist/**: emscripten + tsc build output (generated)
    // - web/coi-serviceworker.js: vendored third-party (MIT, pinned)
    // - **/*.ts: type-checked by tsc, formatted by Prettier. Same deal the
    //   wrapper has always had: eslint here has no TS parser (adding one means a
    //   new dev dep and a second rule set), and tsc under tsconfig.strict.json
    //   already covers what js.configs.recommended would catch on these files,
    //   no-undef via real resolution, no-unused-vars via noUnusedLocals /
    //   noUnusedParameters, no-fallthrough via noFallthroughCasesInSwitch.
    // - coverage/**: generated reports
    ignores: [
      'dist/**',
      '_site/**', // assembled deploy output (dist/ + web/, see tools/assemble-site.mjs)
      '_build/**', // compiled web/ TypeScript (see tools/build-web.mjs)
      '.vercel/**', // Vercel CLI local state + prebuilt output
      'node_modules/**',
      'coverage/**',
      '.playwright-cli/**',
      'web/coi-serviceworker.js',
      'src/index.js', // gitignored symlink to the built wrapper (see tools/link-wrapper.mjs)
      '**/*.ts',
    ],
  },

  js.configs.recommended,

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
