flow: node_modules
	`npm bin`/flow check src/

eslint:
	cd src/; `npm bin`/eslint .

git-ancestor:
	git fetch origin
	git merge-base --is-ancestor origin/master master

yarn:
	yarn

node_modules:
	yarn

clean:
	rm -rf lib
	rm -rf dist

build: clean node_modules
	cp -r src/ lib
	find lib/ -type f ! -name '*.js' | xargs -I {} rm {}
	find lib/ -name '*.js' | xargs -I {} mv {} {}.flow
	`npm bin`/babel src --out-dir lib

.version-%: .move-in-%
	npm install	
	make build-$* || ( make .cleanup-$* && false )
	`npm bin`/bump ${TYPE} || ( make .cleanup-$* && false )
	make build-$* || ( make .cleanup-$* && false )
	npm publish || ( make .cleanup-$* && false )
	make .cleanup-$*

.version: yarn git-clean git-ancestor flow eslint build
	npm version ${TYPE}
	npm publish
	git push
	git push --tags

version-patch: TYPE = patch
version-patch: .version

version-minor: TYPE = minor
version-minor: .version

version-major: TYPE = major
version-major: .version

git-clean:
	test ! -n "$$(git status --porcelain)"


