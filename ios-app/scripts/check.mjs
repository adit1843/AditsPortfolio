import fs from 'node:fs';
const paths=['capacitor.config.ts','www/index.html','www/style.css','www/main.js','www/icon.svg'];
for (const path of paths) if(!fs.existsSync(path)) throw Error('Missing '+path);
const config=fs.readFileSync('capacitor.config.ts','utf8');
if(/^\s*server\s*:/m.test(config)) throw Error('Release config cannot use a remote server');
console.log('Neosis iOS scaffold files verified (not an Xcode build).');
