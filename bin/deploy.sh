#!/bin/sh

set -x
set -e

if [ ! -f package.json ]; then
    echo "Please run from base directory"
    exit 1
fi

version=`cat package.json | jq -r .version`
major_version=`echo $version | sed 's/\..*//'`
target_path="../webwallet-data/trezor.js/$major_version"

# copy to target
mkdir -p $target_path
cp dist/trezor.js $target_path/trezor.js

# commit
cd $target_path
git add ./trezor.js
git commit ./trezor.js -m "Update trezor.js to $version"
