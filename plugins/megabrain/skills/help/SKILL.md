---
name: help
description: "Cartão de referência da megabrain: as skills (`/megabrain:init`, `/megabrain:card`, `/megabrain:help`), os playbooks do card, os scripts (`boot.mjs`, `control.mjs`, `blast-radius`), a configuração e, num projeto com `.megabrain/`, as superfícies e os comandos de cada uma. Use com `/megabrain:help`, ou quando perguntarem como usar a megabrain, que comandos ela tem ou por onde começar."
---

# megabrain — ajuda

Mostre este cartão quando invocado. Uso único: não suba nada, não escreva nada, não rode `doctor`.
Responda na língua do usuário. Mostre as seções nesta ordem; a única que roda algo é "Neste projeto".

## Skills

| Skill | Comando | O que faz |
|---|---|---|
| **init** | `/megabrain:init` | Prepara o repositório: lê o código, propõe `.megabrain/config.json` (superfícies, portas, banco, migrations, credencial da seed, runtime do app mobile) e cria a base vazia. Uma vez por projeto. |
| **card** | `/megabrain:card <link do card>` | Do card do ClickUp ao PR: diz nas próprias palavras o que vai fazer e espera o OK (o único checkpoint), implementa, prova no sistema rodando e entrega o link de criação do PR. |
| **help** | `/megabrain:help` | Este cartão. |

## Playbooks do card

O `/megabrain:card` escolhe pelo tipo do card; dá para pedir um pelo nome.

| Playbook | Quando |
|---|---|
| `bug` | defeito, comportamento errado, "não funciona" |
| `feature` | comportamento novo ou mudado, com critério de aceite ou análise técnica |
| `prototype` | "Decidir com protótipo", ou a resposta só aparece vendo rodar |
| `multi-pr` | mexe em contrato (API/SDK/types) e em app, ou o TL;DR tem várias áreas |
| `why` | "por que isso é assim?", ou um bug que pode ser regra mudada de propósito |
| `map` | mapear o fluxo de uma área que vai voltar a ser mexida |

## Scripts

`node "${CLAUDE_PLUGIN_ROOT}/scripts/<script>"`, a partir da raiz do checkout (é lá que eles acham a
config). No cartão, mostre só o nome do script.

| Script | Comando | O que faz |
|---|---|---|
| `boot.mjs` | `env` · `status` · `up <superfícies>` · `down` | portas e dados desta worktree; sobe e derruba só o que esta rodada subiu |
| `boot.mjs` | `migrate` | aplica as migrations pendentes nos dados desta worktree |
| `boot.mjs` | `seed <fixture> [--check]` | monta uma pré-condição de teste de `.megabrain/fixtures/` |
| `control.mjs` | `<superfície> doctor` | diz se a superfície está pronta para ser dirigida e o que corrigir — sempre primeiro |
| `control.mjs` | `<superfície> <comando>` | dirige a superfície: web, Electron ou Android (React Native ou Flutter) |
| `blast-radius.mjs` | `main...HEAD` · `--staged` · `--files <a> <b>` | quais superfícies, telas e fluxos a mudança alcança |

## Neste projeto

- **Sem `.megabrain/config.json`** na raiz do checkout: diga que o primeiro passo é
  `/megabrain:init` e pule para "Por onde começar".
- **Com ela:** rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs" --help` e mostre a saída como
  está, num bloco de código — ela lista as superfícies do projeto e os comandos de cada driver,
  inclusive os que o projeto acrescenta em `.megabrain/control/`. Não copie essa lista para este
  arquivo: ela muda com o plugin e com o projeto. Diga quais fluxos já estão mapeados em
  `.megabrain/flows/` ("nenhum ainda" quando a pasta não existe ou está vazia).

## Configuração

- Tudo que o projeto sabe fica em `<repo>/.megabrain/`: `config.json`, `README.md`, `flows/`,
  `features/`, `fixtures/`, `blind-spots.md` e as extensões em `control/<superfície>.mjs`.
- Formato da config: `${CLAUDE_PLUGIN_ROOT}/skills/card/references/config.md`.
- App mobile: `android.runtime` é `react-native` (padrão) ou `flutter`. Se estiver errado, o `doctor`
  acusa a diferença para o APK instalado e `control.mjs <app> runtime <flutter|react-native>` troca.
- Evidência de cada rodada: `.agent-evidence/<branch>/` (fora do git).

## Atualizar

`/plugin marketplace update dev10` e depois `/reload-plugins`. Para receber sozinho: `/plugin` ›
Marketplaces › dev10 › Enable auto-update.

## Por onde começar

1. `/megabrain:init`, se o projeto ainda não tem `.megabrain/`.
2. `control.mjs <superfície> doctor`, para ver se o ambiente está pronto.
3. `/megabrain:card <link do card>`.

## Mais

Código e PRs: https://github.com/pedidos10/claude-plugins — sem acesso de escrita, faça fork e abra o
PR a partir dele.
