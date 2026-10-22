import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG, MEGABRAIN, listeners, script, trySh } from '../env.mjs';
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
    print,
    sleep,
} from './common.mjs';

export function androidDriver(name, spec, ext = {}) {
    const PKG = spec.android.package;
    // Flutter has no Metro and no JS runtime: the screen is read and driven through adb alone
    const RUNTIME = spec.android.runtime || 'react-native';
    const FLUTTER = RUNTIME === 'flutter';
    const METRO = spec.android.metroPort || 8081;
    // the debug build points the app at localhost:<appApiPort>; adb reverse delivers it to this worktree's API
    const APP_API_PORT = spec.android.appApiPort;
    const API_PORT = env.ports[CONFIG.api];
    const label = spec.label || name;
    const metroStart = spec.android.metroStart || 'start Metro for this app';
    const buildDebug = spec.android.build || 'build and install the debug variant';

    const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
    const ADB = fs.existsSync(path.join(SDK, 'platform-tools/adb'))
        ? path.join(SDK, 'platform-tools/adb')
        : 'adb';

    const adb = (...args) => trySh(ADB, args);
    const shell = (...args) => adb('shell', ...args);

    function requireDevice() {
        const devices = (adb('devices') || '')
            .split('\n')
            .slice(1)
            .map(l => l.trim().split(/\s+/))
            .filter(([, state]) => state === 'device');
        if (!devices.length)
            throw new CtlError(
                'no Android device attached',
                '~/Library/Android/sdk/emulator/emulator -avd Pixel_9_Pro_16kb -no-snapshot-load &',
            );
        if (devices.length > 1 && !process.env.ANDROID_SERIAL)
            throw new CtlError(
                `${devices.length} devices attached: ${devices.map(d => d[0]).join(', ')}`,
                'export ANDROID_SERIAL=<one of them>',
            );
    }

    /** What the installed APK was built with, from its native libraries; null when it cannot be read. */
    function installedRuntime() {
        const apk = (shell('pm', 'path', PKG) || '').match(/package:(\S+base\.apk)/)?.[1];
        if (!apk) return null;
        const libs = shell('unzip', '-l', apk) || '';
        if (/libflutter\.so/.test(libs)) return 'flutter';
        if (/lib(hermes|reactnative|jsc)\w*\.so/.test(libs)) return 'react-native';
        return null;
    }

    // ------------------------------------------------------------- hierarchy

    const decode = s =>
        s
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#10;/g, '\n')
            .replace(/&amp;/g, '&');

    const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();

    /** uiautomator refuses to dump while something animates ("could not get idle state"), so it is retried. */
    function dumpNodes() {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty') || '';
            if (xml.includes('<hierarchy')) {
                return [...xml.matchAll(/<node ([^>]*?)\/?>/g)]
                    .map(m =>
                        Object.fromEntries(
                            [...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], decode(a[2])]),
                        ),
                    )
                    .filter(n => !/systemui|inputmethod/.test(`${n.package} ${n['resource-id']}`))
                    .map(n => {
                        const [x1, y1, x2, y2] = n.bounds.match(/\d+/g).map(Number);
                        return {
                            text: n.text,
                            desc: n['content-desc'],
                            id: n['resource-id'],
                            cls: n.class.replace(/^android\.(widget|view)\./, ''),
                            clickable: n.clickable === 'true',
                            editable: n.class === 'android.widget.EditText',
                            focused: n.focused === 'true',
                            x: Math.round((x1 + x2) / 2),
                            y: Math.round((y1 + y2) / 2),
                            w: x2 - x1,
                            h: y2 - y1,
                        };
                    });
            }
        }
        throw new CtlError(
            'uiautomator could not dump the screen',
            'something keeps animating; wait-for a text, then retry',
        );
    }

    const labelOf = n => n.text || n.desc;

    // a native Alert (RN Alert.alert) is the usual reason a tap "did nothing"
    const dialogsIn = nodes => nodes.filter(n => /:id\/(alertTitle|alert_title)$/.test(n.id)).map(n => n.text);

    function findTarget(nodes, target) {
        const coords = target.match(/^(\d+),(\d+)$/);
        if (coords)
            return {
                x: Number(coords[1]),
                y: Number(coords[2]),
                w: 1,
                h: 1,
                cls: 'point',
            };
        let match;
        if (target.startsWith('id='))
            match = n => n.id === target.slice(3) || n.id.endsWith(`:id/${target.slice(3)}`);
        else if (target.startsWith('desc=')) match = n => norm(n.desc) === norm(target.slice(5));
        // Flutter merges a card's lines into one label, so its text is matched by a part of it
        else if (target.startsWith('text~='))
            match = n => [n.text, n.desc].some(label => norm(label).includes(norm(target.slice(6))));
        // Flutter exposes a widget's text as its content-desc, never as text
        else if (target.startsWith('text='))
            match = n =>
                norm(n.text) === norm(target.slice(5)) || (FLUTTER && norm(n.desc) === norm(target.slice(5)));
        else
            throw new CtlError(
                `bad target ${target}`,
                'text=<visible text>, text~=<part of it>, desc=<content-desc>, id=<testID> or x,y',
            );
        // RN often puts the text on a child of the touchable; tapping the text's centre still hits the touchable
        const found = nodes.filter(n => match(n) && n.w > 0 && n.h > 0);
        if (!found.length) return null;
        return found.find(n => n.clickable || n.editable) || found[0];
    }

    const keyboardShown = () => /mInputShown=true/.test(shell('dumpsys', 'input_method') || '');

    function hideKeyboard() {
        if (!keyboardShown()) return false;
        shell('input', 'keyevent', 'KEYCODE_BACK');
        return true;
    }

    // a field is often targeted by its floating label, which is a sibling TextView, not the EditText
    const fieldNear = (nodes, node) =>
        node.editable
            ? node
            : nodes
                  .filter(n => n.editable)
                  .sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y))
                  .find(n => Math.abs(n.y - node.y) <= n.h) || node;

    async function tapTarget(target, { field = false } = {}) {
        let nodes = dumpNodes();
        let node = findTarget(nodes, target);
        if (node && field && node.cls !== 'point') node = fieldNear(nodes, node);
        if (!node) {
            throw new CtlError(
                `no element on screen matches ${target}`,
                `on screen: ${[...new Set(nodes.map(labelOf).filter(Boolean))].slice(0, 25).join(' | ')}`,
            );
        }
        // the keyboard covers the bottom half, and a tap there reports success while hitting a key
        let hidKeyboard = false;
        if (!field && !node.editable && hideKeyboard()) {
            hidKeyboard = true;
            await sleep(400);
            nodes = dumpNodes();
            node = findTarget(nodes, target) || node;
        }
        if (field && node.cls !== 'point' && !node.editable)
            throw new CtlError(`${target} is not an input field`, 'dump, and target the editable node');
        const info = {
            x: node.x,
            y: node.y,
            cls: node.cls,
            label: labelOf(node) || null,
            hidKeyboard,
        };
        if (dryRun) return { tapped: false, dryRun: true, ...info };
        shell('input', 'tap', String(node.x), String(node.y));
        return { tapped: true, ...info };
    }

    // ------------------------------------------------------------------ Hermes

    /** The debug build connects to Metro, which exposes the Hermes runtime over CDP. Release builds never do. */
    async function hermesTarget() {
        let targets;
        try {
            targets = await httpJson(`http://localhost:${METRO}/json/list`);
        } catch {
            throw new CtlError(`Metro does not answer on :${METRO}`, metroStart);
        }
        // the app registers two targets; only "React Native …" is the JS runtime, "UI" never answers evaluate
        const page = targets.find(
            t => (t.appId === PKG || (t.title || '').includes(PKG)) && /React Native/.test(t.description || ''),
        );
        if (!page)
            throw new CtlError(
                `no Hermes runtime of the ${label} registered in Metro`,
                `install the debug build (doctor says how), adb reverse tcp:${METRO} tcp:${METRO}, then reopen the app`,
            );
        return page;
    }

    async function withHermes(fn) {
        const page = await hermesTarget();
        const cdp = await connectCdp(page.webSocketDebuggerUrl, {
            asyncEval: false,
            where: `the ${label} JS runtime`,
        });
        try {
            return await fn(cdp);
        } finally {
            cdp.close();
        }
    }

    /**
     * No navigation ref is exported by the app, so the current route is read from React's own tree: the
     * NavigationContainer provides an object with getRootState() through context, and context providers
     * keep it in memoizedProps.value.
     */
    const routeSource = `
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook || !hook.getFiberRoots) return { error: 'no React DevTools hook in this runtime' };
    let nav = null;
    for (const id of hook.renderers.keys()) {
        for (const root of hook.getFiberRoots(id)) {
            const stack = [root.current];
            while (stack.length && !nav) {
                const f = stack.pop();
                const v = f.memoizedProps && f.memoizedProps.value;
                if (v && typeof v.getRootState === 'function') nav = v;
                if (f.sibling) stack.push(f.sibling);
                if (f.child) stack.push(f.child);
            }
        }
    }
    if (!nav) return { error: 'navigation container not found' };
    const path = [];
    let s = nav.getRootState();
    while (s && s.routes) {
        const r = s.routes[s.index];
        path.push(r.name);
        s = r.state;
    }
    const current = nav.getCurrentRoute();
    return { route: path.join('/'), params: current ? current.params ?? null : null };
`;

    // --------------------------------------------------------------- doctor

    async function doctor() {
        const { checks, add } = newChecks();
        await checkApi(add);

        try {
            requireDevice();
        } catch (error) {
            add('device', 'fail', error.message, error.fix);
            return finishDoctor(checks);
        }
        add(
            'device',
            'ok',
            `${process.env.ANDROID_SERIAL || 'one device'}, Android SDK ${shell(
                'getprop',
                'ro.build.version.sdk',
            )}`,
        );

        if (!(shell('pm', 'list', 'packages', PKG) || '').includes(PKG)) {
            add('app', 'fail', `${PKG} is not installed`, 'build the debug app (fix of the "debug" check)');
            return finishDoctor(checks);
        }
        const installed = installedRuntime();
        if (installed && installed !== RUNTIME)
            add(
                'runtime',
                'fail',
                `the installed app is ${installed}, but the surface is configured as ${RUNTIME}`,
                `control.mjs ${name} runtime ${installed}`,
            );
        else add('runtime', 'ok', installed ? RUNTIME : `${RUNTIME} (could not read the installed APK)`);

        const debuggable = !/not debuggable/.test(shell('run-as', PKG, 'true') ?? 'not debuggable');
        if (debuggable)
            add('debug', 'ok', FLUTTER ? 'debug build' : 'debug build: loads the bundle from Metro');
        else
            add(
                'debug',
                'fail',
                FLUTTER
                    ? 'release build installed: your code is not running and it talks to its compiled API'
                    : 'release build installed: it ignores Metro (your code is not running) and talks to its compiled API',
                buildDebug,
            );

        const reverse = adb('reverse', '--list') || '';
        const apiRev = reverse.match(new RegExp(`tcp:${APP_API_PORT} tcp:(\\d+)`));
        if (!apiRev)
            add(
                'api-reverse',
                'fail',
                `the app's localhost:${APP_API_PORT} goes nowhere`,
                `control.mjs ${name} reverse`,
            );
        else if (Number(apiRev[1]) !== API_PORT)
            add(
                'api-reverse',
                'fail',
                `the app's :${APP_API_PORT} goes to host :${apiRev[1]}, not this worktree's API :${API_PORT}`,
                `control.mjs ${name} reverse`,
            );
        else add('api-reverse', 'ok', `app :${APP_API_PORT} → host :${API_PORT}`);

        if (!FLUTTER) {
            if (!listeners(METRO).length) add('metro', 'fail', `nothing listens on :${METRO}`, metroStart);
            else if (!new RegExp(`tcp:${METRO} tcp:${METRO}`).test(reverse))
                add(
                    'metro',
                    'fail',
                    'Metro is up but the device cannot reach it',
                    `control.mjs ${name} reverse`,
                );
            else add('metro', 'ok', `:${METRO}, reversed`);
        }

        const top = shell('dumpsys', 'activity', 'activities') || '';
        // Android 10 and older name the field mResumedActivity
        const resumed =
            top.match(/(?:topResumedActivity|mResumedActivity)[=:] ?\S+ \S+ (\S+)/)?.[1] || 'unknown';
        if (!resumed.startsWith(PKG))
            add(
                'foreground',
                'warn',
                `${resumed} is in front`,
                `adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`,
            );
        else {
            add('foreground', 'ok', resumed);
            const dialogs = dialogsIn(dumpNodes());
            if (dialogs.length)
                add(
                    'dialog',
                    'warn',
                    `native dialog on screen: ${dialogs.join(' | ')}`,
                    'tap its button or back before anything else',
                );
        }

        if (debuggable && !FLUTTER) {
            try {
                const r = await withHermes(cdp => cdp.evaluate(routeSource));
                if (r.error)
                    add('hermes', 'warn', `connected, but ${r.error}`, 'state still works through adb');
                else add('hermes', 'ok', `route ${r.route}`);
            } catch (error) {
                add('hermes', 'fail', error.message, error.fix);
            }
        }

        if (keyboardShown())
            add('keyboard', 'warn', 'keyboard open: it covers the bottom of the screen', 'hide-keyboard');
        return finishDoctor(checks);
    }

    // --------------------------------------------------------------- commands

    // adb input text cannot type non-ASCII, reads %s as a space, and runs through the device shell
    function adbText(text) {
        if (/[^\x20-\x7e]/.test(text))
            throw new CtlError(
                'adb cannot type non-ASCII text',
                'use ASCII test data (no accents) for typed fields',
            );
        return `'${text.replace(/ /g, '%s').replace(/'/g, "'\\''")}'`;
    }

    const commands = {
        doctor,

        // the runtime is the surface's config, so switching it rewrites .megabrain/config.json
        runtime: value => {
            requireDevice();
            if (!value)
                return print({
                    ok: true,
                    command: 'runtime',
                    configured: RUNTIME,
                    installed: installedRuntime(),
                });
            if (!['flutter', 'react-native'].includes(value))
                throw new CtlError(`unknown runtime ${value}`, 'flutter or react-native');
            const file = path.join(MEGABRAIN, 'config.json');
            const config = JSON.parse(fs.readFileSync(file, 'utf8'));
            config.surfaces[name].android.runtime = value;
            if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(config, null, 4)}\n`);
            print({ ok: true, command: 'runtime', from: RUNTIME, to: value, file, dryRun });
        },

        reverse: () => {
            requireDevice();
            if (dryRun) return print({ ok: true, command: 'reverse', dryRun: true });
            adb('reverse', `tcp:${APP_API_PORT}`, `tcp:${API_PORT}`);
            if (!FLUTTER) adb('reverse', `tcp:${METRO}`, `tcp:${METRO}`);
            print({
                ok: true,
                command: 'reverse',
                api: `${APP_API_PORT} → ${API_PORT}`,
                ...(FLUTTER ? {} : { metro: `${METRO} → ${METRO}` }),
            });
        },

        state: async () => {
            requireDevice();
            const nodes = dumpNodes();
            let route = null;
            if (!FLUTTER) {
                try {
                    route = await withHermes(cdp => cdp.evaluate(routeSource));
                } catch (error) {
                    route = { error: error.message };
                }
            }
            print({
                ok: true,
                command: 'state',
                ...route,
                keyboard: keyboardShown(),
                dialogs: dialogsIn(nodes),
                texts: [...new Set(nodes.map(labelOf).filter(Boolean))].slice(0, 40),
            });
        },

        dump: mode => {
            requireDevice();
            const nodes = dumpNodes().filter(n => mode === '--all' || labelOf(n) || n.clickable || n.editable);
            print({
                ok: true,
                command: 'dump',
                nodes: nodes.map(n => ({
                    ...(n.text ? { text: n.text } : {}),
                    ...(n.desc && n.desc !== n.text ? { desc: n.desc } : {}),
                    ...(n.id ? { id: n.id } : {}),
                    cls: n.cls,
                    at: `${n.x},${n.y}`,
                    ...(n.clickable ? { clickable: true } : {}),
                    ...(n.editable ? { editable: true, focused: n.focused } : {}),
                })),
            });
        },

        tap: async (...words) => {
            const target = words.join(' ');
            if (!target) throw new CtlError('tap needs a target', 'text=<visible text>, desc=, id= or x,y');
            requireDevice();
            const result = await tapTarget(target);
            let dialogs = [];
            if (!dryRun) {
                await sleep(600);
                dialogs = dialogsIn(dumpNodes());
            }
            print({
                ok: true,
                command: 'tap',
                target,
                ...result,
                ...(dialogs.length ? { dialogs } : {}),
            });
        },

        // the field keeps what it had; it is selected and deleted before typing
        type: async (target, ...words) => {
            const text = words.join(' ');
            if (!target || !text)
                throw new CtlError(
                    'type needs a target and a text',
                    `control.mjs ${name} type "text=E-mail" someone@x.com`,
                );
            requireDevice();
            const escaped = adbText(text);
            const result = await tapTarget(target, { field: true });
            if (!dryRun) {
                await sleep(300);
                shell('input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
                shell('input', 'keyevent', 'KEYCODE_DEL');
                shell('input', 'text', escaped);
            }
            print({
                ok: true,
                command: 'type',
                target,
                typed: dryRun ? null : text.length,
                ...result,
            });
        },

        'hide-keyboard': () => {
            requireDevice();
            print({
                ok: true,
                command: 'hide-keyboard',
                hidden: dryRun ? false : hideKeyboard(),
            });
        },

        back: () => {
            requireDevice();
            if (!dryRun) shell('input', 'keyevent', 'KEYCODE_BACK');
            print({ ok: true, command: 'back', dryRun });
        },

        // without the package name Android hands https links to Chrome: App Link verification never passes on an emulator
        'open-link': url => {
            if (!url) throw new CtlError('open-link needs a URL', 'a deep link the app handles');
            requireDevice();
            if (!dryRun) shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, PKG);
            print({ ok: true, command: 'open-link', dryRun });
        },

        launch: () => {
            requireDevice();
            if (!dryRun) shell('monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
            print({ ok: true, command: 'launch', dryRun });
        },

        'wait-for': async (...words) => {
            const last = words[words.length - 1];
            const timeoutMs = /^\d+$/.test(last) ? Number(words.pop()) : 15000;
            const target = words.join(' ');
            if (!target)
                throw new CtlError(
                    'wait-for needs a target',
                    `control.mjs ${name} wait-for "text=<visible text>" 20000`,
                );
            requireDevice();
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const nodes = dumpNodes();
                const node = findTarget(nodes, target);
                if (node)
                    return print({
                        ok: true,
                        command: 'wait-for',
                        target,
                        at: `${node.x},${node.y}`,
                    });
                await sleep(500);
            }
            throw new CtlError(`${target} did not appear in ${timeoutMs}ms`, 'state, to see what is on screen');
        },

        eval: source => {
            if (FLUTTER)
                throw new CtlError(
                    'a Flutter app has no JS runtime to evaluate',
                    'read the screen with state or dump',
                );
            if (!source)
                throw new CtlError('eval needs JavaScript', `control.mjs ${name} eval "return __DEV__"`);
            return withHermes(async cdp =>
                print({ ok: true, command: 'eval', value: await cdp.evaluate(source) }),
            );
        },

        screenshot: file => {
            requireDevice();
            const out = file ? path.resolve(file) : evidenceFile(name, 'png');
            const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], {
                maxBuffer: 64 * 1024 * 1024,
            });
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, png);
            print({ ok: true, command: 'screenshot', file: out });
        },
    };

    Object.assign(
        commands,
        ext.commands
            ? ext.commands({
                  name,
                  spec,
                  env,
                  print,
                  CtlError,
                  sleep,
                  dryRun,
                  shell,
                  adb,
                  withHermes,
                  tapTarget,
              })
            : {},
    );
    const help = `  doctor | runtime [flutter|react-native] | reverse | launch | state | dump [--all] | tap <target> | type <target> <text>
  wait-for <target> [ms] | hide-keyboard | back | open-link <url> | ${FLUTTER ? '' : 'eval <js> | '}screenshot [file]
  target: text=<visible text>, text~=<part of it>, desc=<content-desc>, id=<testID> or x,y${ext.help ? `\n${ext.help}` : ''}`;
    return { commands, help };
}
