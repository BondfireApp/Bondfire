import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version || '3.0.0';

const releaseDir = resolve('release');
const output = resolve(releaseDir, `bondfire-v${version}-webapp.zip`);

mkdirSync(releaseDir, { recursive: true });
rmSync(output, { force: true });

const excludes = [
  '.git/*',
  '.github/*',
  '.idea/*',
  'node_modules/*',
  'release/*',
  'dist/*',
  '.env',
  '.env.*',
  '*.log',
  'desktop.ini',
  '.DS_Store',
];

const args = [
  '-r',
  output,
  '.',
  ...excludes.flatMap((pattern) => ['-x', pattern]),
];

execFileSync('zip', args, { stdio: 'inherit' });

console.log(`\nCreated ${output}`);
