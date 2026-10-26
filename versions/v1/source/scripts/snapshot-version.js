// Saves the current website as an isolated, read-only version folder:
//   versions/vN/source/   copy of server/, public/, scripts/, package files
//   versions/vN/prompt_vN.txt  the prompt that produced this version
//
//   npm run version:snapshot -- <N> <path-to-prompt-file>
//
// Existing versions are never overwritten: the script refuses if vN exists.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const [n, promptFile] = process.argv.slice(2);
if (!/^\d+$/.test(n || '') || !promptFile) {
  console.error('Usage: npm run version:snapshot -- <version-number> <prompt-file>');
  process.exit(1);
}
const dir = path.join(ROOT, 'versions', `v${n}`);
if (fs.existsSync(dir)) {
  console.error(`versions/v${n} already exists. Versions are never overwritten; use the next number.`);
  process.exit(1);
}
const INCLUDE = ['server', 'public', 'scripts', 'test', 'package.json', 'package-lock.json', 'render.yaml', '.env.example', 'README.md'];
fs.mkdirSync(path.join(dir, 'source'), { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, 'source', item), { recursive: true });
}
fs.copyFileSync(path.resolve(promptFile), path.join(dir, `prompt_v${n}.txt`));
fs.writeFileSync(
  path.join(dir, 'VERSION.md'),
  `# v${n}\n\nSnapshot taken ${new Date().toISOString()}.\n\n- \`source/\` is the complete website as it was at v${n}.\n- \`prompt_v${n}.txt\` is the prompt that produced it.\n\nTo run this version on its own: \`cd versions/v${n}/source && npm ci && npm start\`.\n`
);
console.log(`Saved versions/v${n}. Commit it and tag the commit: git tag v${n}`);
