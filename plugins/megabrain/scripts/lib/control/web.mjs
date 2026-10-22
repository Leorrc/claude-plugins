import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG, psql, readRegistry, script, trySh } from '../env.mjs';
import {
    CtlError,
    checkApi,
    dryRun,
    env,
    evidenceFile,
    finishDoctor,
    newChecks,
    ownedBy,
    print,
    seedCredentials,
} from './common.mjs';

// two installs (one per node version) restart each other's daemon and drop the session, so always the same one
const AB = [
    process.env.AGENT_BROWSER,
    trySh('which', ['agent-browser']),
    path.join(path.dirname(process.execPath), 'agent-browser'),
    // .nvmrc pins node 22 while agent-browser lives under node 24: the newest nvm install wins
    ...nvmInstalls().map(dir => path.join(dir, 'bin/agent-browser')),
].find(p => p && fs.existsSync(p));

function nvmInstalls() {
    const root = path.join(os.homedir(), '.nvm/versions/node');
    if (!fs.existsSync(root)) return [];
    const version = v => v.slice(1).split('.').map(Number);
    return fs
        .readdirSync(root)
        .sort((a, b) => {
            const [x, y] = [version(a), version(b)];
            return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
        })
        .map(v => path.join(root, v));
}

const session = surface => `wt-${env.name}-${surface}`;

/** agent-browser with this worktree's session, JSON in and out; one browser session per surface. */
function ab(surface, args, { raw = false } = {}) {
    if (!AB)
        throw new CtlError(
            'agent-browser is not installed',
            'npm i -g agent-browser, or set AGENT_BROWSER=<path>',
        );
    let out;
    try {
        out = execFileSync(AB, ['--session', session(surface), ...(raw ? [] : ['--json']), ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 180000,
        });
    } catch (error) {
        out = error.stdout || '';
        if (raw || !out.trim())
            throw new CtlError(
                `agent-browser ${args[0]} failed: ${(error.stderr || error.message).trim()}`,
                'run doctor',
            );
    }
    if (raw) return out.trim();
    const parsed = JSON.parse(out.trim().split('\n').pop());
    if (!parsed.success)
        throw new CtlError(
            `agent-browser ${args[0]}: ${parsed.error}`,
            'check the selector or the page with state',
        );
    return parsed.data;
}

const evaluate = (surface, source) => {
    const expression = /^\s*\(/.test(source) ? source : `(async () => { ${source} })()`;
    return ab(surface, ['eval', expression]).result;
};

/** What the page says about itself. Next's dev error overlay lives in a shadow root under nextjs-portal. */
const pageSource = ownPort => `
    const nextPortal = document.querySelector('nextjs-portal');
    const nextError = nextPortal && nextPortal.shadowRoot
        ? (nextPortal.shadowRoot.textContent || '').match(/(Unhandled Runtime Error|Build Error|Failed to compile)[^\\n]{0,160}/)
        : null;
    const viteOverlay = document.querySelector('vite-error-overlay');
    const ports = [...new Set(performance.getEntriesByType('resource')
        .map(e => { try { return new URL(e.name); } catch { return null; } })
        .filter(u => u && u.hostname === 'localhost' && Number(u.port) !== ${ownPort})
        .map(u => Number(u.port)))];
    return {
        url: location.href,
        title: document.title,
        buildError: viteOverlay
            ? (viteOverlay.shadowRoot?.textContent || 'vite error overlay').trim().slice(0, 200)
            : nextError ? nextError[0] : null,
        apiPorts: ports,
        storage: Object.keys(localStorage),
        // some apps render text that innerText reports empty; textContent reads it
        text: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 4000),
    };
`;

// Vite dev fills the resource-timing buffer (250) with modules before any API call; CDP sees every request
function calledPorts(surface, page) {
    let hosts = [];
    try {
        hosts = ab(surface, ['network', 'requests']).requests.map(r => new URL(r.url).host);
    } catch {
        // the page entries below still count
    }
    const own = env.ports[surface];
    const fromNetwork = hosts.filter(h => h.startsWith('localhost:')).map(h => Number(h.split(':')[1]));
    return [...new Set([...fromNetwork, ...page.apiPorts])].filter(p => p !== own);
}

function checkPage(add, page, spec) {
    const apiPort = env.ports[CONFIG.api];
    if (page.buildError)
        add(
            'build',
            'fail',
            `error overlay over the page: ${page.buildError}`,
            spec.web?.buildFix || 'rebuild the shared packages, then reload',
        );
    else add('build', 'ok', 'no error overlay');

    const strangers = page.apiPorts.filter(p => p !== apiPort);
    if (strangers.length)
        add(
            'api-target',
            'fail',
            `the page called localhost:${strangers.join(', ')} instead of :${apiPort}`,
            `${script('boot.mjs')} down, then up again: the dev server was started with another API URL`,
        );
    else if (page.apiPorts.includes(apiPort)) add('api-target', 'ok', `page calls :${apiPort}`);
    else
        add(
            'api-target',
            'warn',
            'no API call recorded yet, so the target cannot be confirmed',
            'open a screen that loads data, then rerun doctor',
        );
}

async function surfaceDoctor(surface, spec, entry, extra) {
    const { checks, add } = newChecks();
    await checkApi(add);
    const port = env.ports[surface];

    const owner = ownedBy(surface, port);
    if (owner === 'down') {
        add(
            surface,
            'fail',
            `nothing listens on :${port}`,
            `${script('boot.mjs')} up ${CONFIG.api} ${surface}`,
        );
        return finishDoctor(checks);
    }
    if (owner === 'foreign' && !env.isMain) {
        add(
            surface,
            'fail',
            `:${port} is held by a process this worktree did not start`,
            'stop it where it was started',
        );
        return finishDoctor(checks);
    }
    add(surface, 'ok', `:${port}`);

    if (!AB) {
        add('browser', 'fail', 'agent-browser is not installed', 'npm i -g agent-browser');
        return finishDoctor(checks);
    }
    let page;
    try {
        const current = evaluateSafe(surface, 'return location.href');
        if (!current || !current.startsWith(`http://localhost:${port}`))
            ab(surface, ['open', `http://localhost:${port}${typeof entry === 'function' ? entry() : entry}`]);
        page = evaluate(surface, pageSource(port));
        page.apiPorts = calledPorts(surface, page);
        add('browser', 'ok', `session ${session(surface)} at ${page.url}`);
    } catch (error) {
        add('browser', 'fail', error.message, error.fix);
        return finishDoctor(checks);
    }
    checkPage(add, page, spec);
    if (extra) await extra({ add, page, ctx: helpers(surface) });
    return finishDoctor(checks);
}

function evaluateSafe(surface, source) {
    try {
        return evaluate(surface, source);
    } catch {
        return null;
    }
}

/** What a project extension gets to work with. */
const helpers = surface => ({
    surface,
    env,
    print,
    CtlError,
    dryRun,
    seedCredentials,
    psql,
    readRegistry,
    ab: (args, opts) => ab(surface, args, opts),
    evaluate: source => evaluate(surface, source),
    evaluateSafe: source => evaluateSafe(surface, source),
    pageState: () => evaluate(surface, pageSource(env.ports[surface])),
});

export function webDriver(surface, spec, ext = {}) {
    const base = () => `http://localhost:${env.ports[surface]}`;
    const entry = ext.entry || spec.web?.entry || '/';
    const commands = {
        doctor: () =>
            surfaceDoctor(
                surface,
                spec,
                typeof entry === 'function' ? () => entry(helpers(surface)) : entry,
                ext.doctor,
            ),

        state: () => {
            const page = evaluate(surface, pageSource(env.ports[surface]));
            page.apiPorts = calledPorts(surface, page);
            print({ ok: true, command: 'state', session: session(surface), ...page });
        },

        open: (route = '/') => {
            const url = /^https?:/.test(route) ? route : `${base()}/${route.replace(/^\//, '')}`;
            if (dryRun) return print({ ok: true, command: 'open', url, dryRun: true });
            ab(surface, ['open', url]);
            const page = evaluate(surface, pageSource(env.ports[surface]));
            print({
                ok: !page.buildError,
                command: 'open',
                ...page,
                ...(page.buildError
                    ? {
                          error: 'error overlay on the page',
                          fix: spec.web?.buildFix || 'rebuild the shared packages, then reload',
                      }
                    : {}),
            });
            if (page.buildError) process.exitCode = 1;
        },

        eval: source => {
            if (!source)
                throw new CtlError(
                    'eval needs JavaScript',
                    `control.mjs ${surface} eval "return location.href"`,
                );
            print({ ok: true, command: 'eval', value: evaluate(surface, source) });
        },

        // every other agent-browser command, already bound to this worktree's session
        ab: (...args) => {
            if (!args.length)
                throw new CtlError(
                    'ab needs an agent-browser command',
                    `control.mjs ${surface} ab snapshot -i`,
                );
            process.stdout.write(`${ab(surface, args, { raw: true })}\n`);
        },

        screenshot: file => {
            const out = file ? path.resolve(file) : evidenceFile(surface, 'png');
            fs.mkdirSync(path.dirname(out), { recursive: true });
            ab(surface, ['screenshot', out]);
            print({ ok: true, command: 'screenshot', file: out });
        },

        close: () => {
            ab(surface, ['close']);
            print({ ok: true, command: 'close', session: session(surface) });
        },

        ...(ext.commands ? ext.commands(helpers(surface)) : {}),
    };
    const help = `  doctor | state | open [route] | eval <js> | ab <agent-browser args> | screenshot [file] | close${
        ext.help ? `\n${ext.help}` : ''
    }`;
    return { commands, help };
}
