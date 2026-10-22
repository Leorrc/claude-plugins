# `.megabrain/config.json`

Tudo que o `boot.mjs`, o `control.mjs` e o `blast-radius` sabem sobre um projeto. Exemplo completo:
`.megabrain/config.json` do comanda10.

```jsonc
{
    "name": "entregas10",                       // pasta de estado: ~/.megabrain/<name>/ (registry, logs)
    "packageFilter": "pnpm --filter",           // como rodar o script de um pacote do monorepo
    "infra": {
        "containers": ["entregas10_dev-db"],    // precisam estar de pé antes do boot
        "compose": { "cwd": "apps/server", "file": "docker-compose-dev.yaml", "envFile": ".env" }
    },
    "database": {
        "container": "entregas10_dev-db",       // psql roda por `docker exec`
        "envFile": "apps/server/.env",          // lido sem imprimir
        "url": { "env": "DATABASE_URL" },        // ou "user"/"name": { "env": "...", "default": "..." }
        "isolation": { "mode": "database" },     // schema (com "main" e "env") | database | none
        "migrations": {
            "engine": "prisma",                  // typeorm (classe na tabela "table") | prisma (_prisma_migrations)
            "dir": "apps/server/prisma/migrations",
            "cwd": "apps/server",
            "run": "npx prisma migrate deploy",
            "seed": "npx prisma db seed"
        }
    },
    "credentials": { "file": "apps/server/prisma/seed.ts", "pattern": "regex com 2 grupos: email, senha" },
    "fixtures": { "vars": { "business_id": { "flag": "--business", "default": "<uuid>" } } },
    "api": "server",                             // a superfície que é a API (doctor confere dona e migrations)
    "apiUrlEnv": ["NEXT_PUBLIC_SERVER_URL"],     // variáveis apontadas para a API desta worktree
    "blastRadius": null,                         // comando próprio do projeto; null = o genérico do plugin
    "surfaces": {
        "server": {
            "dir": "apps/server",                // o que o blast-radius genérico usa para APPS TO BOOT
            "pkg": "server", "script": "dev",    // ou "command": "...", com "cwd"
            "port": { "offset": 33 },            // 3000 + slot*100 + offset; "main" fixa a porta do checkout principal
            "env": { "PORT": "{port}" },         // {port} {base} {base+N} {apiUrl} {schema} {database}
            "driver": "api"
        },
        "web": { "dir": "apps/web", "pkg": "web", "script": "dev", "port": { "offset": 3 },
                 "args": ["-p", "{port}"], "driver": "web", "web": { "entry": "/" } },
        "entregador": { "driver": "android", "external": true,
                        "android": { "package": "...", "appApiPort": 3333, "metroPort": 8081,
                                     "metroStart": "...", "build": "..." } },
        "app": { "driver": "android", "external": true,
                 "android": { "runtime": "flutter", "package": "...", "appApiPort": 4000, "build": "..." } }
    }
}
```

Drivers: `api` (só sobe), `web` (`agent-browser`), `electron` (CDP; `electron.nativeBridge`,
`ignorePorts`, `buildFix`), `android` (adb + Hermes; `external`: não sobe pelo boot).
`android.runtime` é `react-native` (padrão) ou `flutter`. No Flutter não há Metro nem runtime JS: o
`doctor` não confere Metro/Hermes, o `reverse` só leva a API, o `state` não traz rota e o `eval` não
existe. A tela é lida pelo uiautomator, onde o Flutter põe o texto do widget no `content-desc` (`text=`
também o casa) e junta as linhas de um card num rótulo só (`text~=<parte>` casa por trecho). O `doctor`
compara o runtime com o APK instalado (`libflutter.so` ou Hermes/React Native), e
`control.mjs <app> runtime <flutter|react-native>` troca o valor na config.
Superfície com `mode` (`env`, `override`, `default`, `values`) sobe no modo pedido e o registry
guarda qual foi.

**Extensões** — `.megabrain/control/<superfície>.mjs` exporta o que só o projeto sabe: `help`
(linhas extras do `--help`), `doctor(ctx)` (checks a mais), `commands(ctx)` (login, seleções),
`state` (electron: corpo JS que devolve estado extra), `entry(ctx)` (web: rota inicial calculada).
Exemplos: `.megabrain/control/*.mjs` do comanda10.
