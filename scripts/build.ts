import path from 'path';
import fs from 'fs';

const src = path.resolve(import.meta.dir, '..', 'src', 'index.ts');
const dist = path.resolve(import.meta.dir, '..', 'dist');

let build = await Bun.build({
    external: ['node-datachannel', '@geckos.io/server'],
    target: 'node',
    entrypoints: [src],
});

let builds = build.outputs.map((output) => {
    return output.text();
});

let built = await Promise.all(builds);

// destroy dist
if (fs.existsSync(dist)) {
    fs.rmdirSync(dist, { recursive: true });
}

// make dist
fs.mkdirSync(dist);

fs.writeFileSync(path.join(dist, 'index.js'), `import { createRequire } from "module";
const require = createRequire(import.meta.url);
` + built[0].replaceAll('import.meta.require', 'require'));

export { };