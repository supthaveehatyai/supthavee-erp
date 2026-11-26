import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const out = [];

out.push('====================================================================');
out.push('SUPTHAVEE ERP SUPERAPP - CODEBASE ARCHITECTURE AUDIT');
out.push(`Generated At: ${new Date().toISOString()}`);
out.push('====================================================================');
out.push('');

let branch = 'main';
try { branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(); } catch {}
out.push(`[1] GIT STATUS & RECENT COMMITS (Branch: ${branch})`);
try {
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  if (status) out.push(status);
  const log = execSync('git log -n 12 --oneline', { encoding: 'utf8' }).trim();
  if (log) out.push(log);
} catch {}
out.push('');

out.push('[2] PACKAGE.JSON (Scripts & Dependencies)');
const pkgRaw = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
out.push(JSON.stringify({
  name: pkgRaw.name,
  scripts: pkgRaw.scripts,
  dependencies: pkgRaw.dependencies,
  devDependencies: pkgRaw.devDependencies,
}, null, 2));
out.push('');

out.push('[3] ENVIRONMENT VARIABLE KEYS (Secrets Masked)');
for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(root, envName);
  if (fs.existsSync(envPath)) {
    const keys = fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => `  ${l.split('=')[0].trim()}=***`);
    if (keys.length) out.push(...keys);
    break;
  }
}
out.push('');

const scanRoots = ['app', 'components', 'lib', 'types', 'utils', 'supabase'];
const allFiles = [];
function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const rel = path.posix.join(dir.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) walk(rel);
    else allFiles.push(rel);
  }
}
scanRoots.forEach(walk);
allFiles.sort((a, b) => a.localeCompare(b));

out.push(`[4] PROJECT FILE TREE (${allFiles.length} source files)`);
allFiles.forEach((f) => out.push(`  ${f}`));
out.push('');

out.push('[5] ROUTES, SERVER ACTIONS & SUPABASE RPC CALLS');
const uniqueRpcs = new Set();
const codeFiles = allFiles.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith('types/'));

for (const f of codeFiles) {
  const content = fs.readFileSync(path.join(root, f), 'utf8');
  const isUseServer = /^\s*['"]use server['"]/m.test(content);
  const isRouteOrPage = /(^|\/)(page|layout|route)\.(tsx|ts)$/.test(f);

  const exportedFns = [...content.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const rpcs = [...new Set([...content.matchAll(/\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]))];
  rpcs.forEach((r) => uniqueRpcs.add(r));

  if (isUseServer || isRouteOrPage || rpcs.length > 0) {
    out.push(`- ${f}${isUseServer ? ' [USE SERVER]' : ''}`);
    if (exportedFns.length > 0) out.push(`    exported async fns: ${exportedFns.join(', ')}`);
    if (rpcs.length > 0) out.push(`    supabase.rpc(): ${rpcs.join(', ')}`);
  }
}
out.push('');

const sortedRpcs = [...uniqueRpcs].sort((a, b) => a.localeCompare(b));
out.push(`[6] UNIQUE SUPABASE RPCs REFERENCED IN CODE (${sortedRpcs.length})`);
sortedRpcs.forEach((r) => out.push(`  - ${r}`));
out.push('');

fs.writeFileSync(path.join(root, 'supthavee-codebase-audit.txt'), out.join('\n'), 'utf8');
console.log(`Done: supthavee-codebase-audit.txt (${allFiles.length} files, ${sortedRpcs.length} RPCs)`);
