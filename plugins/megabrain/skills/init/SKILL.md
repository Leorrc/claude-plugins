---
name: init
description: "Prepara um projeto para a megabrain: lê o repositório, propõe e escreve `.megabrain/config.json` (superfícies, portas, banco, isolamento por worktree, migrations, credencial da seed), cria a base vazia (README, flows, features, fixtures, blind-spots) e confere com `boot.mjs env` e `control.mjs --help`. Use com `/megabrain:init` num repositório que ainda não tem `.megabrain/`."
---

Formato da config: `${CLAUDE_PLUGIN_ROOT}/skills/card/references/config.md`. Leia antes de tudo.

1. **Levante sem perguntar** (só leitura; nunca leia `.env` — use `.env.example`):
   - workspace (`pnpm-workspace.yaml`, `package.json` workspaces, `turbo.json`) e cada app em
     `apps/*`: framework (Next, Vite, Nest, Electron, React Native, Flutter), script de dev, como recebe a
     porta, qual variável aponta para a API;
   - banco: `docker-compose*`, ORM (TypeORM, Prisma), pasta de migrations, seed, como o app recebe
     schema ou URL. Extensões como postgis só existem uma vez por banco → isolamento `database`;
   - credencial de dev: o arquivo da seed que cria o usuário admin (regex com email e senha).
   - app mobile: o runtime decide o que o driver `android` confere, então escreva-o sempre em
     `android.runtime`. `pubspec.yaml` com `flutter:` → `flutter`; `react-native` nas
     dependências do `package.json` → `react-native`. O package sai do `applicationId` em
     `android/app/build.gradle*`. Se errar, `control.mjs <app> doctor` acusa a diferença para o
     APK instalado e `control.mjs <app> runtime <flutter|react-native>` corrige.
2. **Mostre a proposta** (tabela de superfícies: pasta, driver, porta, variável da API; banco e
   isolamento; o que ficou incerto) e espere o OK — é o único checkpoint.
3. **Escreva** `.megabrain/config.json`, `.megabrain/README.md` (superfícies e o que for
   específico do projeto), `.megabrain/flows/README.md` (legenda + fila vazia),
   `.megabrain/features/README.md` (pré-condições base), `.megabrain/fixtures/`,
   `.megabrain/blind-spots.md`. Garanta `.agent-evidence/` no `.gitignore`.
4. **Confira**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/boot.mjs" env` (portas e dados) e
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs" --help`. Subir de verdade
   (`boot.mjs up <api> <web>` + `control.mjs <web> doctor`) só com o OK do dev: o primeiro boot
   cria schema ou banco e roda migrations + seed.
5. **Proponha o primeiro fluxo** a mapear (`/megabrain:card mapear <fluxo>`), pelo que o repo já
   documenta de regra de negócio.

Não escreva credencial em lugar nenhum. Não crie extensões em `.megabrain/control/` antes de
dirigir a superfície: elas nascem da primeira armadilha real (login, seleção de contexto).
