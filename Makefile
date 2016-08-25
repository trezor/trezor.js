check: node_modules
	flow check src/
	cd src/; eslint .

node_modules:
	npm install

build: clean build_node build_browserify

clean:
	rm -rf lib
	rm -rf dist

build_node: clean node_modules
	cp -r src/ lib
	find lib/ -type f ! -name '*.js' | xargs -I {} rm {}
	find lib/ -name '*.js' | xargs -I {} mv {} {}.flow
	BABEL_ENV=srctolib `npm bin`/babel src --out-dir lib

build_browserify: clean node_modules
	mkdir dist
	`npm bin`/browserify lib/index.js --s trezor > dist/trezor.js
	cat dist/trezor.js | `npm bin`/uglifyjs -c -m > dist/trezor.min.js

npm_preversion: check

npm_version: build
	git add -A lib
	git diff-index --quiet --cached HEAD || git commit -m 'Build'

npm_postversion:
	git push
	git push --tags
	npm publish
