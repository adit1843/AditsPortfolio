import fs from 'node:fs';
const paths=['capacitor.config.ts','capacitor.dev.config.ts','scripts/prepare-dev.mjs','www/index.html','www/style.css','www/main.js','www/icon.svg'];
for(const file of paths){if(!fs.existsSync(file))throw Error('Missing '+file);}
const release=fs.readFileSync('capacitor.config.ts','utf8');
if(/^\s*server\s*:/m.test(release))throw Error('Release config contains remote server configuration');
const dev=fs.readFileSync('capacitor.dev.config.ts','utf8');
if(!dev.includes('server:') || !dev.includes('https://aditsanghani.com/briefing/'))throw Error('Development server configuration missing');
console.log('Neosis iOS development and release configurations validated. No native build performed.');
