import fs from 'node:fs';
import path from 'node:path';

import { CONFIG, fill, script } from '../env.mjs';
import {
    CtlError,
    checkApi,
    connectCdp,
    dryRun,
    env,
    evidenceFile,
    finishDoctor,
    httpJson,
    newChecks,
    ownedBy,
    print,
    seedCredentials,
    sleep,
} from './common.mjs';

/**
 * MUI cards and similar have no role, so accessibility snapshots miss them; and a handler called
 * directly never runs React's synthetic onClick. Targets are resolved in the DOM and hit with a real
 * mouse event at their centre, after checking nothing (a fixed action bar) covers them.
 */
const resolveTargetSource = target => `
    const target = ${JSON.stringify(target)};
    let el;
    if (target.startsWith('text=')) {
        // innerText splits a card into lines; compare with whitespace collapsed
        const norm = t => (t || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const wanted = norm(target.slice(5));
        const matches = [...document.querySelectorAll('body *')].filter(
            n => n.offsetParent !== null && norm(n.innerText) === wanted,
        );
        el = matches.find(n => !matches.some(m => m !== n && n.contains(m)));
    } else {
        el = document.querySelector(target);
    }
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const covered = !(top && (top === el || el.contains(top)));
    return {
        found: true,
        x, y,
        width: r.width, height: r.height,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim().slice(0, 80),
        covered,
        coveredBy: covered && top ? (top.innerText || top.tagName).trim().slice(0, 80) : null,
    };
`;

/** What every Electron renderer can say about itself; the project extension adds its own state. */
const baseStateSource = (bridge, extra) => `
    const apiPorts = [...new Set(
        performance.getEntriesByType('resource')
            .map(e => { try { return new URL(e.name); } catch { return null; } })
            .filter(u => u && u.hostname === 'localhost')
            .map(u => Number(u.port)),
    )];
    const overlay = document.querySelector('#webpack-dev-server-client-overlay') || document.querySelector('vite-error-overlay');
    let buildOverlay = null;
    if (overlay) {
        try {
            const doc = overlay.contentDocument || overlay.shadowRoot;
            buildOverlay = (doc.body || doc).textContent.trim().split('\\n').slice(0, 4).join(' | ');
        } catch { buildOverlay = 'present (unreadable)'; }
    }
    const base = {
        buildOverlay,
        // an Electron renderer often routes in memory, so location.hash stays empty; the active link is the route
        route: [...document.querySelectorAll('a[href*="#/"]')]
            .filter(a => a.classList.contains('active') || a.getAttribute('aria-current'))
            .map(a => a.getAttribute('href'))[0] || location.hash || null,
        nativeBridge: ${bridge ? `typeof window[${JSON.stringify(bridge)}] === 'object'` : 'null'},
        visibility: document.visibilityState,
        localhostPorts: apiPorts,
    };
    const extra = (() => { ${extra || 'return {};'} })();
    return { ...base, ...extra };
`;

export function electronDriver(name, spec, ext = {}) {
    const cdpPort = () => env.ports[name];
    const options = spec.electron || {};
    const label = spec.label || name;
    const stateSource = baseStateSource(options.nativeBridge, ext.state);

    async function pageTarget() {
        let targets;
        try {
            targets = await httpJson(`http://localhost:${cdpPort()}/json/list`);
        } catch {
            throw new CtlError(
                `nothing answers CDP on :${cdpPort()}`,
                `${script('boot.mjs')} up ${name}, then run doctor until cdp is ok`,
            );
        }
        const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
        if (!page)
            throw new CtlError(`CDP is up but the ${label} window has no page target yet`, 'wait, then retry');
        return page;
    }

    const connect = async () =>
        connectCdp((await pageTarget()).webSocketDebuggerUrl, { where: `the ${label} window` });

    async function withCdp(fn) {
        const cdp = await connect();
        try {
            return await fn(cdp);
        } finally {
            cdp.close();
        }
    }

    async function realClick(cdp, target) {
        const info = await cdp.evaluate(resolveTargetSource(target));
        if (!info.found)
            throw new CtlError(
                `no visible element matches ${target}`,
                'eval to inspect the DOM; text= compares the rendered text, case-insensitive',
            );
        if (!info.width || !info.height)
            throw new CtlError(`${target} has no size on screen`, 'it is hidden; open what contains it first');
        if (info.covered)
            throw new CtlError(
                `${target} is covered by "${info.coveredBy}" — a click there would hit the cover, silently`,
                'close the overlay or scroll the container so the element is not under a fixed bar',
            );
        if (dryRun) return { clicked: false, dryRun: true, ...info };

        const base = { x: info.x, y: info.y, button: 'left', clickCount: 1 };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
        return { clicked: true, ...info };
    }

    // a click leaves the caret wherever it landed, so leftover text must be selected and typed over
    async function fillField(cdp, target, text) {
        const result = await realClick(cdp, target);
        if (dryRun) return result;
        await cdp.evaluate('const el = document.activeElement; if (el && el.select) el.select(); return true');
        await cdp.send('Input.insertText', { text });
        return result;
    }

    const readState = cdp => cdp.evaluate(stateSource);
    const ctx = {
        name,
        spec,
        env,
        print,
        CtlError,
        sleep,
        dryRun,
        seedCredentials,
        withCdp,
        realClick,
        fillField,
        readState,
        script,
    };

    async function doctor() {
        const { checks, add } = newChecks();
        await checkApi(add);

        const owner = ownedBy(name, cdpPort());
        if (owner === 'down') {
            add('cdp', 'fail', `nothing answers CDP on :${cdpPort()}`, `${script('boot.mjs')} up ${name}`);
            return finishDoctor(checks);
        }
        if (owner === 'foreign') {
            add(
                'cdp',
                'fail',
                `:${cdpPort()} is held by a process this worktree did not start`,
                'stop it where it was started',
            );
            return finishDoctor(checks);
        }
        add('cdp', 'ok', `:${cdpPort()}`);

        let cdp;
        try {
            cdp = await connect();
        } catch (error) {
            add('window', 'fail', error.message, error.fix);
            return finishDoctor(checks);
        }

        try {
            const s = await readState(cdp);

            // the overlay covers the whole window, so every click lands on it until the build is clean
            if (s.buildOverlay)
                add(
                    'build',
                    'fail',
                    `build error overlay over the window: ${s.buildOverlay}`,
                    options.buildFix || 'rebuild the shared packages, then reload',
                );
            else add('build', 'ok', 'no build error overlay');

            if (options.nativeBridge) {
                if (s.nativeBridge)
                    add('electron', 'ok', `window.${options.nativeBridge} present — the native side exists`);
                else
                    add(
                        'electron',
                        'fail',
                        `window.${options.nativeBridge} is undefined: this is a browser build, blind to the native side`,
                        `drive ${name}, the Electron surface`,
                    );
            }

            // the dev server's own ports are not an API; any other localhost port the renderer called is
            const ignored = [cdpPort(), ...(options.ignorePorts || []).map(p => Number(fill(p, env)))];
            const called = s.localhostPorts.filter(p => !ignored.includes(p));
            const apiPort = env.ports[CONFIG.api];
            const strangers = called.filter(p => p !== apiPort);
            if (strangers.length)
                add(
                    'api-target',
                    'fail',
                    `the renderer called localhost:${strangers.join(
                        ', ',
                    )} instead of :${apiPort} — a bundle from another branch`,
                    `${script('boot.mjs')} down; clear the bundler cache; boot again`,
                );
            else if (called.includes(apiPort)) add('api-target', 'ok', `renderer calls :${apiPort}`);
            else
                add(
                    'api-target',
                    'warn',
                    'no API call recorded yet, so the target cannot be confirmed',
                    'log in, then rerun doctor',
                );

            if (ext.doctor) await ext.doctor({ add, state: s, cdp, ctx });

            if (s.visibility === 'visible')
                add('window', 'ok', `visible, at ${s.route || 'a screen without a route link'}`);
            else
                add(
                    'window',
                    'warn',
                    'window hidden: screenshots will hang; eval still works',
                    `bring the ${label} window to the front`,
                );
        } finally {
            cdp.close();
        }
        return finishDoctor(checks);
    }

    const commands = {
        doctor,

        state: () => withCdp(async cdp => print({ ok: true, command: 'state', ...(await readState(cdp)) })),

        eval: source => {
            if (!source)
                throw new CtlError('eval needs JavaScript', `control.mjs ${name} eval "return location.hash"`);
            return withCdp(async cdp =>
                print({ ok: true, command: 'eval', value: await cdp.evaluate(source) }),
            );
        },

        // setting location.hash does not move an in-memory router, so routes are reached by clicking their link
        open: route => {
            if (!route) throw new CtlError('open needs a route', `control.mjs ${name} open <route without #/>`);
            const hash = `#/${route.replace(/^#?\/?/, '')}`;
            return withCdp(async cdp => {
                const links = await cdp.evaluate(
                    `return [...document.querySelectorAll('a[href*="#/"]')].map(a => a.getAttribute('href'))`,
                );
                const href = links.find(h => h.endsWith(hash));
                if (!href)
                    throw new CtlError(
                        `no link to ${hash} on screen`,
                        `links on screen: ${[...new Set(links)].join(', ') || 'none — log in first'}`,
                    );
                const result = await realClick(cdp, `a[href="${href}"]`);
                if (!dryRun) {
                    await sleep(600);
                    const s = await readState(cdp);
                    if (s.route !== hash)
                        throw new CtlError(
                            `clicked ${hash} but the screen is ${s.route}`,
                            'a dialog may have blocked navigation; screenshot to see',
                        );
                }
                print({ ok: true, command: 'open', route: hash, ...result });
            });
        },

        // a submit blocked by validation looks exactly like a submit that worked, so visible field errors are reported
        click: target => {
            if (!target) throw new CtlError('click needs a target', 'a CSS selector, or text=<visible text>');
            return withCdp(async cdp => {
                const result = await realClick(cdp, target);
                let formErrors = [];
                let dialogs = [];
                if (!dryRun) {
                    await sleep(500);
                    ({ formErrors, dialogs } = await cdp.evaluate(`
                        return {
                            formErrors: [...document.querySelectorAll('.MuiFormHelperText-root.Mui-error, [role=alert][data-field-error]')]
                                .filter(e => e.offsetParent !== null)
                                .map(e => e.innerText.trim())
                                .filter(Boolean),
                            // a confirmation stacked on top is the usual reason nothing happened yet
                            dialogs: [...document.querySelectorAll('.MuiDialog-root, [role=dialog]')]
                                .map(d => (d.innerText || '').trim().split('\\n')[0])
                                .filter(Boolean),
                        };
                    `));
                }
                print({
                    ok: !formErrors.length,
                    command: 'click',
                    target,
                    ...result,
                    ...(dialogs.length ? { dialogs } : {}),
                    ...(formErrors.length
                        ? {
                              formErrors,
                              error: 'the form refused the submit',
                              fix: 'fill the fields named in formErrors, then click again',
                          }
                        : {}),
                });
                if (formErrors.length) process.exitCode = 1;
            });
        },

        // controlled React inputs ignore a value set from JS; focusing by click and inserting text goes through onChange
        type: (target, text) => {
            if (!target || text === undefined)
                throw new CtlError(
                    'type needs a target and a text',
                    `control.mjs ${name} type "input[name=email]" "..."`,
                );
            return withCdp(async cdp => {
                const result = await fillField(cdp, target, text);
                print({ ok: true, command: 'type', target, typed: dryRun ? null : text.length, ...result });
            });
        },

        screenshot: file =>
            withCdp(async cdp => {
                const visibility = await cdp.evaluate('return document.visibilityState');
                if (visibility !== 'visible')
                    throw new CtlError(
                        `the ${label} window is hidden; CDP never answers a screenshot then`,
                        'bring the window to the front',
                    );
                const out = file ? path.resolve(file) : evidenceFile(name, 'png');
                const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 8000);
                fs.mkdirSync(path.dirname(out), { recursive: true });
                fs.writeFileSync(out, Buffer.from(data, 'base64'));
                print({ ok: true, command: 'screenshot', file: out });
            }),

        // errors surface as toasts that vanish before a later read; capture must start before the click
        toasts: mode =>
            withCdp(async cdp => {
                if (mode === 'watch') {
                    await cdp.evaluate(`
                        if (window.__ctlToasts) return;
                        window.__ctlToasts = [];
                        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
                            const text = n.nodeType === 1 ? (n.innerText || '').trim() : '';
                            if (text && /alert|snackbar|toast|notistack|sonner/i.test(n.className + ' ' + (n.getAttribute('role') || ''))) {
                                window.__ctlToasts.push({ at: new Date().toISOString(), text });
                            }
                        }))).observe(document.body, { childList: true, subtree: true });
                    `);
                    print({ ok: true, command: 'toasts', watching: true });
                } else if (mode === 'read') {
                    const captured = await cdp.evaluate('return window.__ctlToasts || null');
                    if (captured === null)
                        throw new CtlError(
                            'nothing is being captured',
                            `control.mjs ${name} toasts watch, before the action`,
                        );
                    print({ ok: true, command: 'toasts', captured });
                } else
                    throw new CtlError('toasts takes watch or read', 'watch before the action, read after it');
            }),

        'wait-settle': ms =>
            withCdp(async cdp => {
                const quiet = Number(ms) || 600;
                const waited = await cdp.evaluate(`
                    const quiet = ${quiet};
                    const start = Date.now();
                    return await new Promise(resolve => {
                        let timer;
                        const done = () => { obs.disconnect(); resolve(Date.now() - start); };
                        const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
                        obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
                        timer = setTimeout(done, quiet);
                        setTimeout(done, 15000);
                    });
                `);
                print({ ok: true, command: 'wait-settle', quietMs: quiet, waitedMs: waited });
            }),

        ...(ext.commands ? ext.commands(ctx) : {}),
    };

    const help = `  doctor | state | eval <js> | open <route> | click <target> | type <target> <text>
  screenshot [file] | toasts watch|read | wait-settle [ms]
  target: a CSS selector or text=<visible text>; --dry-run resolves without clicking${
      ext.help ? `\n${ext.help}` : ''
  }`;

    return { commands, help };
}
