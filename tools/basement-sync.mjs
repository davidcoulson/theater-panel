// Assembles web/basement/ - the basement panel as a Home Assistant custom card - from the
// theater panel's own pieces: Preact, htm, the effects engine, the fonts and the textures.
// Home Assistant loads a card as one ES module from /local/, with no import map, so every bare
// specifier ('preact', 'preact/hooks', 'htm') is rewritten to a relative path on the way in.
//
//   node tools/basement-sync.mjs           then
//   scp -r web/basement hassio@10.2.3.6:/config/www/
//
// web/basement/basement-panel.js and dev.html are source; everything else here is copied.

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web', 'basement');
const MODULES = join(ROOT, 'node_modules');

const REWRITE = [
  [/from\s*["']preact\/hooks["']/g, 'from "../vendor/preact-hooks.mjs"'],
  [/from\s*["']preact["']/g, 'from "../vendor/preact.mjs"'],
  [/from\s*["']htm["']/g, 'from "../vendor/htm.mjs"'],
];

async function copyModule(src, dest, rewrites) {
  let text = await readFile(src, 'utf8');
  for (const [re, to] of rewrites) text = text.replace(re, to);
  text = text.replace(/\/\/# sourceMappingURL=.*$/m, '');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text);
}

await mkdir(OUT, { recursive: true });

// vendor: preact's hooks module imports "preact" itself, so it points at its sibling.
await copyModule(join(MODULES, 'preact/dist/preact.module.js'), join(OUT, 'vendor/preact.mjs'), []);
await copyModule(join(MODULES, 'preact/hooks/dist/hooks.module.js'), join(OUT, 'vendor/preact-hooks.mjs'), [[/from\s*["']preact["']/g, 'from "./preact.mjs"']]);
await copyModule(join(MODULES, 'htm/dist/htm.module.js'), join(OUT, 'vendor/htm.mjs'), []);

// lib: the effects engine and the html/Icon helpers, as used by the theater panel.
for (const f of ['effects.mjs', 'ui.mjs']) await copyModule(join(ROOT, 'web/lib', f), join(OUT, 'lib', f), REWRITE);

// fonts and textures
await mkdir(join(OUT, 'fonts'), { recursive: true });
const FONTS = {
  'big-shoulders-display': ['700', '800'], 'ibm-plex-sans': ['500', '600', '700'], 'ibm-plex-mono': ['600'],
};
for (const [family, weights] of Object.entries(FONTS)) {
  for (const w of weights) {
    const name = `${family}-latin-${w}-normal.woff2`;
    await copyFile(join(MODULES, '@fontsource', family, 'files', name), join(OUT, 'fonts', name));
  }
}
await mkdir(join(OUT, 'assets'), { recursive: true });
for (const a of ['planks-rail.jpg', 'plaster.jpg', 'suede.jpg']) await copyFile(join(ROOT, 'web/assets', a), join(OUT, 'assets', a));

console.log('web/basement assembled');
