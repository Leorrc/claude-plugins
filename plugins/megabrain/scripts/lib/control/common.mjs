import fs from 'node:fs';
import path from 'node:path';

import {
    CONFIG,
    LOGS,
    ROOT,
    descendsFrom,
    evidenceDir,
    listeners,
    pendingMigrations,
    readRegistry,
    resolveEnv,
    script,
} from '../env.mjs';

export const env = resolveEnv();
export const dryRun = process.argv.includes('--dry-run');

export const print = obj => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class CtlError extends Error {
    constructor(message, fix) {
        super(message);
        this.fix = fix;
    }
}

export const evidenceFile = (prefix, ext) =>
    path.join(evidenceDir(), `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`);

export async function httpJson(url, timeoutMs = 2000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.json();
}

/**
 * One CDP websocket. `asyncEval` wraps bodies in an async IIFE and awaits the promise; Hermes does not
 * await promises over CDP, so React Native evaluates synchronously.
 */
export async function connectCdp(wsUrl, { asyncEval = true, where = 'the renderer' } = {}) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener(
            'error',
            () => reject(new CtlError('could not open the CDP websocket', 'run doctor')),
            {
                once: true,
            },
        );
    });

    let nextId = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });

    const send = (method, params = {}, timeoutMs = 10000) =>
        new Promise((resolve, reject) => {
            nextId += 1;
            const id = nextId;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(
                    new CtlError(
                        `${method} did not answer`,
                        'run doctor; a hidden window never answers screenshots',
                    ),
                );
            }, timeoutMs);
            pending.set(id, msg => {
                clearTimeout(timer);
                if (msg.error) reject(new CtlError(`${method}: ${msg.error.message}`, 'check the arguments'));
                else resolve(msg.result);
            });
            ws.send(JSON.stringify({ id, method, params }));
        });

    // evaluate shares one global scope across calls, so a bare `const x` fails the second time
    const evaluate = async source => {
        const isExpression = /^\s*\(/.test(source);
        let expression = source;
        if (!isExpression) expression = asyncEval ? `(async () => { ${source} })()` : `(() => { ${source} })()`;
        const out = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: asyncEval,
        });
        if (out.exceptionDetails) {
            const text = out.exceptionDetails.exception?.description || out.exceptionDetails.text;
            throw new CtlError(`${where} threw: ${text}`, `fix the expression; it runs inside ${where}`);
        }
        return out.result.value;
    };

    return { send, evaluate, close: () => ws.close() };
}

export function ownedBy(surfaceName, port) {
    const holders = listeners(port);
    if (!holders.length) return 'down';
    const pid = readRegistry()[env.worktree]?.pids?.[surfaceName];
    if (pid && holders.some(h => h === pid || descendsFrom(h, pid))) return 'ours';
    return 'foreign';
}

/** The checks every surface shares: an API this worktree owns, on data with every migration. */
export async function checkApi(add) {
    const api = CONFIG.api;
    if (api) {
        const port = env.ports[api];
        const owner = ownedBy(api, port);
        if (owner === 'down')
            add('api', 'fail', `nothing listens on :${port}`, `${script('boot.mjs')} up ${api}`);
        else if (owner === 'foreign' && !env.isMain) {
            add(
                'api',
                'fail',
                `:${port} is held by a process this worktree did not start — it may serve other data`,
                'stop it where it was started; never drive against an API you do not own',
            );
        } else {
            try {
                const res = await fetch(env.apiUrl, { signal: AbortSignal.timeout(3000) });
                add('api', 'ok', `:${port} answers HTTP ${res.status}, data ${env.schema || env.database}`);
            } catch {
                add(
                    'api',
                    'fail',
                    `:${port} is listening but does not answer HTTP`,
                    `tail ${path.join(LOGS, env.name, `${api}.log`)}`,
                );
            }
        }
    }

    if (!CONFIG.database?.migrations) return;
    // the main checkout's data is never migrated by boot, so it falls behind main silently
    const pending = pendingMigrations(env);
    const target = env.schema || env.database;
    if (pending === null)
        add(
            'migrations',
            'warn',
            `could not read the migrations of ${target}`,
            'is the database container up?',
        );
    else if (pending.length) {
        add(
            'migrations',
            'fail',
            `${pending.length} migration(s) not applied to ${target}: ${pending.join(
                ', ',
            )} — queries touching them fail`,
            `${script('boot.mjs')} migrate`,
        );
    } else add('migrations', 'ok', `${target} has every migration in the repo`);
}

export function newChecks() {
    const checks = [];
    const add = (check, status, detail, fix) => checks.push({ check, status, detail, ...(fix ? { fix } : {}) });
    return { checks, add };
}

export function finishDoctor(checks) {
    const failed = checks.filter(c => c.status === 'fail');
    const warned = checks.filter(c => c.status === 'warn');
    const verdict = failed.length ? 'not drivable' : warned.length ? 'drivable, with warnings' : 'drivable';
    print({ ok: !failed.length, command: 'doctor', project: CONFIG.name, worktree: env.name, verdict, checks });
    if (failed.length) process.exitCode = 2;
}

/** Credentials are read from the project's dev seed at run time and never printed. */
export function seedCredentials() {
    const cred = CONFIG.credentials;
    if (!cred)
        throw new CtlError(
            'no credentials in .megabrain/config.json',
            'add credentials.file and credentials.pattern',
        );
    const file = path.join(ROOT, cred.file);
    const match = fs.readFileSync(file, 'utf8').match(new RegExp(cred.pattern));
    if (!match) throw new CtlError('could not read the seed credentials', `the seed format changed: ${file}`);
    return { email: match[1], password: match[2] };
}
