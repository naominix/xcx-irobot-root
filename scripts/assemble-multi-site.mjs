import path from 'path';
import fs from 'fs-extra';
import {fileURLToPath} from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(projectRoot, 'site-multi');
const output = path.join(projectRoot, '_site-multi');

fs.emptyDirSync(output);
fs.copyFileSync(path.join(source, 'index.html'), path.join(output, 'index.html'));
fs.copyFileSync(path.join(projectRoot, 'dist', 'irobotRoot.mjs'), path.join(output, 'irobotRoot.mjs'));
fs.copyFileSync(path.join(projectRoot, 'dist', 'irobotRoot.mjs.map'), path.join(output, 'irobotRoot.mjs.map'));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log(`Assembled multi-root site at ${path.relative(projectRoot, output)}`);
