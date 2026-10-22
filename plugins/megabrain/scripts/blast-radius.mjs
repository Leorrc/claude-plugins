#!/usr/bin/env node

/**
 * The generic blast radius: changed files → the surfaces whose folder they live in, and the flows,
 * features and maps whose `covers:` prefixes they fall under. A project with a deeper analysis (an
 * import graph from API to screen) points `blastRadius` in its config at its own script instead.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG, MEGABRAIN, ROOT, SURFACES, surfaceMode, trySh } from './lib/env.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');

function changedFiles() {
    const filesFlag = args.indexOf('--files');
    if (filesFlag >= 0) return args.slice(filesFlag + 1).filter(a => !a.startsWith('--'));
    const gitArgs = args.includes('--staged')
        ? ['diff', '--name-only', '--cached']
        : ['diff', '--name-only', args.find(a => !a.startsWith('--')) || 'HEAD'];
    return (trySh('git', gitArgs) || '').split('\n').filter(Boolean);
}

function covers(file) {
    const front = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!front) return [];
    return [...front[1].matchAll(/^\s*-\s*(\S+)\s*$/gm)].map(m => m[1].replace(/\/$/, ''));
}

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.md') && entry.name !== 'README.md' ? [full] : [];
    });
}

const files = changedFiles().map(f => path.relative(ROOT, path.resolve(ROOT, f)));
const under = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`);

const docsFor = dir =>
    walk(path.join(MEGABRAIN, dir))
        .map(doc => ({ doc, hits: covers(doc).filter(c => files.some(f => under(f, c))) }))
        .filter(d => d.hits.length)
        .map(d => ({ file: path.relative(ROOT, d.doc), via: d.hits }));

const surfaces = Object.entries(SURFACES)
    .filter(([, s]) => s.dir)
    .map(([name, s]) => ({ name, files: files.filter(f => under(f, s.dir)), mode: surfaceMode(s) }))
    .filter(s => s.files.length);
const unresolved = files.filter(f => !Object.values(SURFACES).some(s => s.dir && under(f, s.dir)));

const result = {
    files,
    flows: docsFor('flows'),
    features: docsFor('features'),
    maps: docsFor('maps'),
    surfaces,
    unresolved,
};

if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
}

const out = [`${CONFIG.name} — ${files.length} changed file(s)`, ''];
out.push('LEIA ANTES — fluxos');
if (result.flows.length) result.flows.forEach(f => out.push(`  ${f.file}`, `      cobre ${f.via.join(', ')}`));
else out.push('  nenhum fluxo cobre esta mudança — verifique sem roteiro, e mapeie se a área vai voltar');
out.push('');
if (result.features.length) {
    out.push('LEIA ANTES — telas (features)');
    result.features.forEach(f => out.push(`  ${f.file}`));
    out.push('');
}
if (result.maps.length) {
    out.push('LEIA ANTES — mapas de código (secundários)');
    result.maps.forEach(f => out.push(`  ${f.file}`));
    out.push('');
}
out.push('APPS TO BOOT');
if (!surfaces.length) out.push('  (none — no changed file lives in a surface folder)');
surfaces.forEach(s => {
    out.push(`  ${s.name.padEnd(12)} ${String(s.files.length).padStart(3)} file(s)`);
    if (s.mode) out.push(`      mode: ${s.mode}  (default; check the file you are proving)`);
});
if (unresolved.length) {
    out.push('', 'UNRESOLVED (outside every surface folder — look by hand)');
    unresolved.slice(0, 20).forEach(f => out.push(`  ${f}`));
}
process.stdout.write(`${out.join('\n')}\n`);
