#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONFIG, MEGABRAIN, SURFACES } from './lib/env.mjs';
import { androidDriver } from './lib/control/android.mjs';
import { CtlError, print } from './lib/control/common.mjs';
import { electronDriver } from './lib/control/electron.mjs';
import { webDriver } from './lib/control/web.mjs';

const DRIVERS = { electron: electronDriver, web: webDriver, android: androidDriver };

/** The surfaces that can be driven, by the name the agent types: an alias wins over the config key. */
function drivable() {
    const byName = {};
    for (const [key, spec] of Object.entries(SURFACES)) {
        if (!DRIVERS[spec.driver]) continue;
        byName[key] = key;
    }
    for (const [key, spec] of Object.entries(SURFACES)) {
        if (DRIVERS[spec.driver] && spec.alias) byName[spec.alias] = key;
    }
    return byName;
}

/** What only this project knows about a surface lives in `.megabrain/control/<surface>.mjs`. */
async function extension(key) {
    const file = path.join(MEGABRAIN, 'control', `${key}.mjs`);
    return fs.existsSync(file) ? import(pathToFileURL(file).href) : {};
}

const argv = process.argv.slice(2).filter(a => a !== '--dry-run');
const [surface, command, ...args] = argv;

async function help() {
    const names = drivable();
    const parts = [
        `control — drive the running surfaces of ${CONFIG.name}, for agents`,
        '',
        '  control.mjs <surface> <command> [args] [--dry-run]',
        '',
        'Every command prints one JSON object. ok:false carries "error" and "fix"; exit code 1.',
        'Run doctor first, and again after anything surprising. doctor exits 2 when not drivable.',
    ];
    for (const key of [...new Set(Object.values(names))]) {
        const spec = SURFACES[key];
        const name = spec.alias && names[spec.alias] === key ? spec.alias : key;
        const { help: text } = DRIVERS[spec.driver](key, spec, await extension(key));
        parts.push('', `${name} (${spec.driver}${name !== key ? `, surface ${key}` : ''}):`, text);
    }
    process.stdout.write(`${parts.join('\n')}\n`);
}

async function main() {
    if (!surface || surface === 'help' || surface === '--help' || command === '--help') return help();
    const key = drivable()[surface];
    if (!key)
        throw new CtlError(`unknown surface "${surface}"`, `one of: ${Object.keys(drivable()).join(', ')}`);
    const spec = SURFACES[key];
    const { commands } = DRIVERS[spec.driver](key, spec, await extension(key));
    const handler = commands[command];
    if (!handler)
        throw new CtlError(
            `unknown ${surface} command "${command ?? ''}"`,
            `one of: ${Object.keys(commands).join(', ')}`,
        );
    await (command === 'eval' ? handler(args.join(' ')) : handler(...args));
}

main().catch(error => {
    print({ ok: false, command: command ?? null, error: error.message, fix: error.fix ?? 'run doctor' });
    process.exitCode = 1;
});
