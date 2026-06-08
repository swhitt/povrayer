# All build targets are phony: a stale ./dist directory would otherwise
# satisfy `dist:` forever and `make test` would test old artifacts.
# node_modules is a real sentinel target so `npm ci` only reruns when the
# lockfile changes.
.PHONY: dist image shell test web hooks coverage lint

dist:   ## export wasm bundle to ./dist
	docker buildx build --target artifact --output type=local,dest=dist .
image:  ## runnable image
	docker buildx build --target runtime -t povrayer .
shell:  ## interactive builder for debugging
	docker buildx build --target builder -t povrayer-builder . && \
	docker run -it -v "$$PWD/src:/host-src" povrayer-builder bash
node_modules: package.json package-lock.json
	npm ci --no-audit --no-fund && touch node_modules
# Test commands are single-sourced in package.json scripts. They use a quoted
# glob, not `node --test test/node/`: Node 25 stopped expanding bare directory
# positionals into their test files (works on 22, fails on 25); the quoted
# glob is expanded by node itself and works on both.
test: dist node_modules
	npm test
# Deliberately not depending on the phony `dist` target here: that would
# rebuild the wasm on every run. The test -f guard is the "build only if
# missing" semantics that local dev wants.
web: node_modules  ## serve the UI + REPL on :8080 (builds dist only if missing)
	@test -f dist/povray.wasm || $(MAKE) dist
	node test/browser/serve.mjs
hooks:  ## wire git to the committed .githooks (pre-commit, pre-push)
	git config core.hooksPath .githooks
lint: node_modules  ## prettier --check + eslint
	npm run format:check && npm run lint
# Builds dist only if missing (coverage needs the wasm for the browser/node
# render paths), then produces the merged node+browser report.
coverage: node_modules  ## merged node + browser coverage report
	@test -f dist/povray.wasm || $(MAKE) dist
	npm run coverage
