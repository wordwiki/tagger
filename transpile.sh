set -e
echo 'BEGIN SWC'
mkdir -p web-build

cp resources/resource_dir_marker.txt web-build
swc compile --config-file .swcrc utils/*.ts tagger/*.ts --out-dir web-build
cp utils/big.mjs web-build/utils/big.mjs

# deno insists on typscript imports having a .ts extension (for good reasons), and I
# can't figure out how to get SWC to transpile these to .js extensions - so I am doing
# it with 'sed'.  TODO: figure out a better way to do this.
(cd web-build && find . -name "*.js" -exec sed -i 's/^\(import .*\)[.]tsx\?/\1.js/g' "{}" ";")

# probably should do this with an import map instead of this.
sed -i 's/"..\/..\/deno-sqlite\/mod.js"/".\/fake-deno-sqlite.js"/g' web-build/tagger/db.js

echo 'END SWC'
#npx swc -w -d dist client/main.ts client/worker.ts client/greeter.ts
