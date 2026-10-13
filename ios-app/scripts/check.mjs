import fs from 'node:fs';
const paths=['capacitor.config.ts','www/index.html','www/style.css','www/main.js','www/icon.svg'];
for (const path of paths){if(!fs.existsSync(path))throw Error('Missing '+path);}
const config=fs.readFileSync('capacitor.config.ts','utf8');
if(config.includes('server:')||config.includes('server.url'))throw Error('Release config cannot use remote server.url');
console.log('Neosis iOS project files verified (not an Xcode build).');
