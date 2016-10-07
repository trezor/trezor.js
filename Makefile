check: node_modules
	flow check src/
	cd src/; eslint .

git-ancestor:
	git fetch origin
	git merge-base --is-ancestor origin/master master

node_modules:
	npm install

clean:
	rm -rf lib
	rm -rf dist

build-node: clean node_modules
	cp -r src/ lib
	find lib/ -type f ! -name '*.js' | xargs -I {} rm {}
	find lib/ -name '*.js' | xargs -I {} mv {} {}.flow
	`npm bin`/babel src --out-dir lib
	rm lib/index-browser.js
	rm lib/index-browser.js.flow

build-browser: clean node_modules
	cp -r src/ lib
	find lib/ -type f ! -name '*.js' | xargs -I {} rm {}
	find lib/ -name '*.js' | xargs -I {} mv {} {}.flow
	`npm bin`/babel src --out-dir lib
	mkdir dist
	`npm bin`/browserify lib/index-browser.js --s trezor > dist/trezor.js
	cat dist/trezor.js | `npm bin`/uglifyjs -c -m > dist/trezor.min.js
	rm lib/index-node.js
	rm lib/index-node.js.flow

.move-in-%:
	mv README.md README.old.md
	mv README-$*.md README.md
	mv package-$*.json package.json

.cleanup-%:
	mv README.md README-$*.md 
	mv README.old.md README.md
	mv package.json package-$*.json 
	rm -rf lib

.version-%: .move-in-%
	npm install
	make build-$* || ( make .cleanup-$* && false )
	`npm bin`/bump patch || ( make .cleanup-$* && false )
	make build-$* || ( make .cleanup-$* && false )
	npm publish || ( make .cleanup-$* && false )
	make .cleanup-$*

versions: git-clean git-ancestor check .version-node .version-browser
	rm -rf lib
	git add package*.json
	mv package-node.json package.json
	git add dist/trezor.js dist/trezor.min.js
	git commit -m `npm view . version`
	git tag v`npm view . version`
	mv package.json package-node.json
	git push
	git push --tags

git-clean:
	test ! -n "$$(git status --porcelain)"


