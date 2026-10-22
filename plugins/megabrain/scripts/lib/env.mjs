import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The project is the git checkout the agent is working in, never the plugin's own folder: the same
 * scripts serve every project, and each project describes itself in `<root>/.megabrain/config.json`.
 */
function findRoot(start) {
    let dir = path.resolve(start);
    for (;;) {
        if (fs.existsSync(path.join(dir, '.megabrain', 'config.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

export const ROOT = findRoot(process.env.MEGABRAIN_ROOT || process.cwd());
if (!ROOT) {
    process.stderr.write(
        'megabrain: no .megabrain/config.json in this directory or above.\n' +
            'Run the agent from the project checkout, or set it up with /megabrain:init.\n',
    );
    process.exit(1);
}

export const MEGABRAIN = path.join(ROOT, '.megabrain');
export const CONFIG = JSON.parse(fs.readFileSync(path.join(MEGABRAIN, 'config.json'), 'utf8'));
export const HOME = path.join(os.homedir(), '.megabrain', CONFIG.name);
export const REGISTRY = path.join(HOME, 'registry.json');
export const LOGS = path.join(HOME, 'logs');

// stdout redirected to a file makes execFileSync return null even on success
export const sh = (cmd, args, opts = {}) =>
    (
        execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) ??
        ''
    ).trim();

export const trySh = (cmd, args, opts) => {
    try {
        return sh(cmd, args, opts);
    } catch {
        return null;
    }
};

export const readRegistry = () => {
    try {
        return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    } catch {
        return {};
    }
};

export const writeRegistry = data => {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(REGISTRY, `${JSON.stringify(data, null, 2)}\n`);
};

export const listeners = port => {
    const out = trySh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    return out ? out.split('\n').filter(Boolean).map(Number) : [];
};

export const alive = pid => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

/** Walks ppid links up from `pid`; used to prove a listener is ours before trusting or killing it. */
export function descendsFrom(pid, ancestor) {
    let current = pid;
    for (let hop = 0; hop < 12; hop += 1) {
        if (current === ancestor) return true;
        const parent = Number(trySh('ps', ['-o', 'ppid=', '-p', String(current)]));
        if (!parent || parent <= 1) return false;
        current = parent;
    }
    return false;
}

/** Stable 1..9 slot from the worktree path, nudged forward if another live worktree holds it. */
function assignSlot(worktree, registry) {
    const mine = registry[worktree];
    if (mine?.slot) return mine.slot;

    let hash = 0;
    for (const ch of worktree) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

    const taken = new Set(
        Object.entries(registry)
            .filter(([p]) => p !== worktree && fs.existsSync(p))
            .map(([, v]) => v.slot),
    );

    for (let i = 0; i < 9; i += 1) {
        const slot = ((hash + i) % 9) + 1;
        if (!taken.has(slot)) return slot;
    }
    throw new Error('all 9 worktree slots are taken — run `boot.mjs down` in a worktree you are done with');
}

/** `{port}`, `{base}`, `{base+N}`, `{apiUrl}`, `{schema}`, `{database}` in config strings. */
export function fill(template, env, extra = {}) {
    return String(template).replace(/\{(\w+)(?:\+(\d+))?\}/g, (match, key, add) => {
        const vars = {
            base: env.base,
            apiUrl: env.apiUrl,
            schema: env.schema,
            database: env.database,
            ...extra,
        };
        if (!(key in vars)) return match;
        return add ? String(Number(vars[key]) + Number(add)) : String(vars[key]);
    });
}

function surfacePort(spec, env) {
    const pinned = spec.port?.pinEnv && Number(process.env[spec.port.pinEnv]);
    if (pinned) return pinned;
    if (env.isMain && spec.port?.main) return spec.port.main;
    return env.base + (spec.port?.offset ?? 0);
}

export const SURFACES = CONFIG.surfaces;

/** The mode a moded surface boots in: the override variable, else the configured default. */
export const surfaceMode = spec => (spec.mode ? process.env[spec.mode.override] || spec.mode.default : null);

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

export function resolveEnv() {
    const worktree = ROOT;
    const name = path.basename(worktree);
    const isMain = fs.statSync(path.join(worktree, '.git')).isDirectory();
    const registry = readRegistry();
    const slot = isMain ? 0 : assignSlot(worktree, registry);

    const isolation = CONFIG.database?.isolation || { mode: 'none' };
    const env = { worktree, name, isMain, slot, base: 3000 + slot * 100, isolation: isolation.mode };
    env.schema =
        isolation.mode === 'schema'
            ? isMain
                ? isolation.main || 'public'
                : `wt_${slug(name)}`.slice(0, 63)
            : null;
    const mainDb = dbCoordinates().name;
    env.database =
        isolation.mode === 'database' && !isMain ? `${mainDb}_wt_${slug(name)}`.slice(0, 63) : mainDb;

    env.ports = Object.fromEntries(
        Object.entries(SURFACES)
            .filter(([, s]) => s.port)
            .map(([k, s]) => [k, surfacePort(s, env)]),
    );
    env.apiUrl = CONFIG.api ? `http://localhost:${env.ports[CONFIG.api]}` : null;
    return env;
}

/** Reads an env file for coordinates. Values are used, never printed. */
export function readEnvFile(relative) {
    if (!relative) return {};
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) return {};
    return Object.fromEntries(
        fs
            .readFileSync(file, 'utf8')
            .split('\n')
            .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
            .filter(Boolean)
            .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
    );
}

/** user and database name, from explicit variables or from a connection URL. */
export function dbCoordinates() {
    const db = CONFIG.database;
    if (!db) return {};
    const vars = { ...readEnvFile(db.envFile), ...process.env };
    if (db.url) {
        const raw = vars[db.url.env];
        if (raw) {
            const u = new URL(raw);
            return { user: decodeURIComponent(u.username), name: u.pathname.replace(/^\//, ''), url: raw };
        }
    }
    return {
        user: (db.user?.env && vars[db.user.env]) || db.user?.default || 'postgres',
        name: (db.name?.env && vars[db.name.env]) || db.name?.default,
    };
}

/** The variables that point a process at this worktree's data: a schema, or a whole database. */
export function isolationEnv(env) {
    const iso = CONFIG.database?.isolation;
    if (!iso || iso.mode === 'none') return {};
    if (iso.mode === 'schema') return { [iso.env]: env.schema };
    const { url } = dbCoordinates();
    if (!url) return {};
    const u = new URL(url);
    u.pathname = `/${env.database}`;
    return { [CONFIG.database.url.env]: u.toString() };
}

/** Runs one SQL statement in the dev database container; null when the container or query fails. */
export function psql(sql, database) {
    const { user, name } = dbCoordinates();
    return trySh('docker', [
        'exec',
        CONFIG.database.container,
        'psql',
        '-U',
        user,
        '-d',
        database || name,
        '-tAc',
        sql,
    ]);
}

/** Runs a SQL script through psql's stdin, so psql variables (`:'name'`) interpolate. */
export function psqlScript(sql, vars = {}, database) {
    const { user, name } = dbCoordinates();
    const varArgs = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
    return execFileSync(
        'docker',
        [
            'exec',
            '-i',
            CONFIG.database.container,
            'psql',
            '-U',
            user,
            '-d',
            database || name,
            '-v',
            'ON_ERROR_STOP=1',
            ...varArgs,
        ],
        { cwd: ROOT, input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

/** The database this worktree's data lives in, for psql. */
export const worktreeDatabase = env => (env.isolation === 'database' ? env.database : undefined);

/**
 * Migrations in the repo that the worktree's data has not applied. TypeORM records a migration by its
 * class name (a renamed file is still applied); Prisma by its folder name in `_prisma_migrations`.
 */
export function pendingMigrations(env) {
    const m = CONFIG.database?.migrations;
    if (!m) return [];
    const dir = path.join(ROOT, m.dir);
    if (m.engine === 'typeorm') {
        const rows = psql(`select name from "${env.schema || 'public'}".${m.table || 'migrations'}`);
        if (rows === null) return null;
        const applied = new Set(rows.split('\n').filter(Boolean));
        return fs
            .readdirSync(dir)
            .filter(f => f.endsWith('.ts'))
            .filter(f => {
                const cls = fs.readFileSync(path.join(dir, f), 'utf8').match(/class\s+(\w+)/)?.[1];
                return cls && !applied.has(cls);
            });
    }
    if (m.engine === 'prisma') {
        const table = env.schema ? `"${env.schema}"._prisma_migrations` : '_prisma_migrations';
        const rows = psql(
            `select migration_name from ${table} where finished_at is not null and rolled_back_at is null`,
            worktreeDatabase(env),
        );
        if (rows === null) return null;
        const applied = new Set(rows.split('\n').filter(Boolean));
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && !applied.has(e.name))
            .map(e => e.name);
    }
    return [];
}

/** How a fix line names a plugin script: the absolute path, since the plugin lives outside the repo. */
export const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const script = name => `node ${path.join(SCRIPTS, name)}`;

/** Evidence lives per branch, local only (`.agent-evidence/` must be gitignored). */
export function evidenceDir() {
    const branch = trySh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'detached';
    return path.join(ROOT, '.agent-evidence', branch);
}
