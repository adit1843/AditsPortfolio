import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const release = 'capacitor.config.ts';
const dev = 'capacitor.dev.config.ts';
const original = fs.readFileSync(release, 'utf8');
if (!fs.existsSync(dev)) throw Error('Missing '+dev);
try {
  fs.copyFileSync(dev, release);
  execFileSync('npx', ['cap', 'sync', 'ios'], { stdio: 'inherit' });
} finally {
  fs.writeFileSync(release, original);
}
console.log('iOS development app synced; release config restored. Run npx cap open ios. Do not archive the dev iOS project for distribution.');
