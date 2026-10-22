---
name: card
description: "Trabalha um card do ClickUp do link à branch provada no sistema rodando, num projeto que tem `.megabrain/`: lê o card, diz nas próprias palavras o que vai fazer, escolhe o playbook (bug, feature, protótipo, vários PRs, 'por que isso é assim', mapear fluxo), implementa, prova dirigindo as superfícies do projeto e entrega o link de criação do PR. Use com `/megabrain:card <link do card>`, quando pedirem para trabalhar um card, reproduzir um bug, provar uma mudança no app de verdade, mapear um fluxo ou explicar por que uma regra existe. Pouca cerimônia: um checkpoint, no máximo uma pergunta."
---

**Antes de tudo:** o projeto se descreve em `.megabrain/` na raiz do checkout. Leia
`.megabrain/README.md` (superfícies, credenciais, armadilhas do projeto) antes do §2. Sem
`.megabrain/config.json`, pare e ofereça `/megabrain:init`.

Ferramentas, nesta skill e em todo `.megabrain/`:

| Nome | Comando |
|---|---|
| `boot.mjs` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/boot.mjs"` |
| `control.mjs` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs"` |
| `blast-radius` | `blastRadius` de `.megabrain/config.json` se existir; senão `node "${CLAUDE_PLUGIN_ROOT}/scripts/blast-radius.mjs"` |

Rode os três a partir da raiz do checkout (ou de dentro dele): é lá que eles acham a config.

<objective>
Levar um card do link ao PR com prova, sem babá. O dev passa o card; a skill entende,
confirma o entendimento uma vez, executa e volta com o PR pronto para o dev revisar e criar, e a evidência — ou com um
bloqueio nomeado.

A unidade de verificação é o **fluxo** (ex.: fechamento de caixa, pedido, pagamento,
fiscal). O app é a **superfície** onde cada passo acontece. A prova vai no PR, no lugar de
um humano abrir o sistema e conferir requisito a requisito.
</objective>

## 1. Entrada: o card

O card é a especificação; não resuma pelo título.

1. **Leia o card inteiro** pelo MCP do ClickUp: `clickup_get_task` com
   `include: ["description","custom_fields","attachments","checklists","subtasks"]` e
   `clickup_get_task_comments`. Abra os anexos (`clickup_download_task_attachment`): a
   reprodução de verdade costuma estar num print, num vídeo ou num comentário. Sem o
   conector, peça para colar o texto.
2. **Análise técnica no card** (seção da `tech-decisions`) = decisões **fechadas**. Siga;
   não reabra. Se o código contradiz uma delas, é bloqueio (§3), não escolha sua.
3. **Retomada:** se `.agent-evidence/<branch>/report.md` existe, leia-o antes de tudo —
   ele diz onde parou (§4).

## 2. Nas minhas palavras — o único checkpoint

Antes de mexer em código ou subir ambiente, mostre e espere o OK:

```
Card:        <nome> (<id>)
Entendi:     o que muda, em 1–3 frases, nas suas palavras — não copie o card
Playbook:    bug | feature | prototype | multi-pr | why | map
Onde:        app → tela, e a API por trás
Cenário:     o que precisa existir (caixa aberto, cliente com limite, plano, flag…)
Vou provar:  as asserções que fecham o card, e em que nível (§5)
Fora:        o que o card pede e eu não vou fazer, ou que fica para outro PR
Dúvida:      no máximo uma, e só se bloqueia
```

Bug que se vê em um minuto na mão ou mudança que um teste cobre: diga isso aqui e
proponha o caminho curto. Depois do OK, siga até a entrega sem pedir licença de novo.

## 3. Roteador e contrato de autonomia

| O card é… | Playbook |
|---|---|
| defeito, comportamento errado, "não funciona" | `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/bug.md` |
| comportamento novo ou mudado, com critério de aceite ou análise técnica | `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/feature.md` |
| tem "Decidir com protótipo", ou a resposta só aparece vendo rodar | `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/prototype.md` |
| mexe em contrato (API/SDK/types) e em app, ou o TL;DR tem várias áreas | `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/multi-pr.md` |
| "por que isso é assim?", ou um bug que pode ser regra mudada de propósito | `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/why.md` |
| área sem fluxo que vai voltar a ser mexida | `.megabrain/flows/README.md` ("Como mapear") e `${CLAUDE_PLUGIN_ROOT}/skills/card/references/flow-contract.md` |

Leia **só** o playbook escolhido. Um card pode encadear dois (bug → why; feature →
multi-pr): diga no checkpoint.

**Faça sem perguntar:** ler tudo; criar branch (uma por card, com o id do card — `868…` — no nome
e no corpo do PR, para o `why` achar depois); editar; rodar teste alvo (um arquivo por vez — suíte
inteira trava a máquina); `boot.mjs up/down` do que esta worktree sobe; `boot.mjs seed` e
`boot.mjs migrate` nos dados da worktree; o rebuild de pacotes que o `doctor` pedir; commitar na branch;
`git push` da branch.

**Pare e pergunte:** escrever ou apagar dado fora do schema da worktree (`public` do
checkout principal); card que contradiz o sistema de um jeito que muda o escopo; decisão
de produto que nem o card nem a análise técnica fecham; qualquer ação externa além do
push da branch — **criar o PR (nem draft)**, comentar ou mover o card, merge.

**Bloqueio:** tentou e não dá (ambiente, dado, caminho inexistente). Registre no report
o que tentou e o que falta, cubra o que for possível e entregue com o bloqueio
**nomeado**. Nunca diga "verificado" para o que não viu.

## 4. Estado: `.agent-evidence/<branch>/report.md`

Local (`.agent-evidence/` está no `.gitignore`), um por branch, atualizado a cada etapa.
É a memória da rodada: quem retoma lê o report, os comentários do card e `git log`.
Sem `.planning/`, sem outro arquivo de estado.

```markdown
# <card> (<id>) — <playbook>
## Nas minhas palavras        (o bloco do §2, como foi aprovado)
## Decisões                   (o que escolhi no caminho e por quê; uma linha cada)
## Feito                      (commits, com o hash)
## Prova                      (tabela: passo · feito · observado · banco)
## Não verificado             (e por quê)
## Próximo                    (vazio quando entregue)
```

## 5. Profundidade proporcional

| Nível | Quando | Prova |
|---|---|---|
| **0 — só teste** | sem tela, sem contrato novo, sem dinheiro; teste cobre | teste alvo que falha antes e passa depois |
| **1 — raio + telas** | toca tela ou contrato | nível 0 + `blast-radius`; sobe só `APPS TO BOOT`; dirige as telas candidatas e confere as asserções dos fluxos de `LEIA ANTES` |
| **2 — fluxo inteiro** | toca dinheiro (caixa, pagamento, fiscal, estoque) ou mais de um app | nível 1 + o fluxo de `.megabrain/flows/` ponta a ponta, banco conferido |

Não suba nada além do nível. Na dúvida entre dois, o de cima.

## 6. Barra de prova

Prova conta quando:

- **gatilho e estado final na mesma evidência** — o clique e o resultado (toast, tela,
  linha), não só o resultado;
- **o efeito no banco foi lido** por SQL, não deduzido da tela;
- **cobre os estados que a mudança toca:** sucesso, cancelar, erro, vazio e persistência
  (recarregar e ver de novo);
- o que é **inalcançável** nesta máquina (`.megabrain/blind-spots.md`) é nomeado, e o
  caminho real mais próximo é coberto no lugar.

## 7. Entrega

1. `blast-radius --staged` antes de cada commit que mexe em regra: fluxo
   ou mapa em `LEIA ANTES` cuja asserção mudou é corrigido **no mesmo commit**.
2. Commits na convenção do CLAUDE.md do projeto.
3. **Não crie o PR.** PR, mesmo draft, entra na lista do time e alguém revisa sem saber que
   ninguém conferiu. Entregue o link de criação já preenchido, para o dev revisar e criar:
   `https://github.com/<org>/<repo>/compare/main...<branch>?expand=1&title=<título>&body=<corpo>`
   (título e corpo com `encodeURIComponent`; o corpo também vai no report, para o caso de o
   link ficar longo demais). Corpo: o que mudou (1–3 linhas) · tabela de prova do report ·
   não verificado · fluxos tocados. Evidência é texto; screenshot fica local.
4. Na resposta final: o link de criação do PR, o caminho da pasta de evidência local, o que
   ficou provado, o que não, e **um texto pronto para colar no card**. Não comente no card sem
   o dev pedir.
5. `boot.mjs down`.

O que você descobriu dirigindo volta para a base no mesmo PR: pré-condição escondida vai
para o fluxo; caminho impossível vai para `.megabrain/blind-spots.md`. Uma linha basta.

## O motor

1. **Raio** — `blast-radius` diz quais superfícies e telas a mudança alcança e quais fluxos e
   features cobrem o que foi tocado.
2. **Ambiente** — `boot.mjs up <superfícies>` sobe só o que o raio apontou.
3. **Dirigir** — `control.mjs <superfície> doctor`, depois os comandos da CLI.
4. **Prova** — `.agent-evidence/<branch>/`; o resumo vai para o corpo do PR.
5. **Limpar** — `boot.mjs down` derruba só o que esta rodada subiu.

### Raio de impacto

```bash
blast-radius main...HEAD          # a branch inteira
blast-radius --staged            # o que está no index
blast-radius --files a.ts b.tsx  # lista explícita, sem git
```

- **APPS TO BOOT** são as superfícies. Superfície com modo (`mode:`) sobe no modo do que você
  vai validar — o `README` do projeto diz a variável.
- **screen:** são candidatas, não certezas.
- **LEIA ANTES — fluxos / telas (features):** leia antes de subir nada; pré-condições primeiro.
  "Nenhum fluxo cobre" = você verifica sem roteiro.
- **LEIA ANTES — mapas de código** são atalho, nunca verdade.
- **UNRESOLVED:** migration, repositório, consumer, código morto. Olhe à mão; mudança que não
  alcança superfície se prova pelo caminho dela (fila, log, banco), não por browser.

### Ambiente

```bash
boot.mjs env | status | up <superfícies> | down
boot.mjs migrate                     # migrations pendentes nos dados desta worktree
boot.mjs seed <fixture> [--check]    # .megabrain/fixtures/<fixture>.sql
```

**Worktree nova: crie pelo Orca** (skill `orca-cli`), não com `git worktree add` — o Orca copia
os `.env`, e o agente não consegue copiá-los (o hook de segredo bloqueia até o `cp`).

Cada worktree tem slot, portas e dados próprios (schema ou banco, conforme a config). Porta
ocupada por outra worktree é recusa, nunca `kill`. Nada de `pkill -f node`. O que a config não
isola (fila, cache) é compartilhado: fluxo que depende disso pede uma API só.

Depois de um merge, o `doctor` acusa build velho e migration pendente: rode o rebuild que ele
pedir e `boot.mjs migrate`.

### Dirigir

`control.mjs <superfície> doctor` **primeiro, sempre**, e de novo depois de qualquer surpresa.
`control.mjs --help` lista superfícies e comandos — os genéricos do driver (Electron por CDP, web
por `agent-browser`, Android por adb + Hermes, ou só adb num app Flutter) e os que o projeto acrescenta em
`.megabrain/control/<superfície>.mjs`. Na web, o que a CLI não cobre passa por `ab <comando do
agent-browser>`. Procedimento por superfície em `.megabrain/surfaces/` e por tela em
`.megabrain/features/`.

Credencial: a seed do projeto, lida pela CLI em tempo de execução. **Nunca escreva credencial
na skill, no `.megabrain/` nem no repositório.**

Substituir um passo por chamada de API só vale **na origem do fluxo** (criar o pedido que você
vai fechar), nunca no ponto que está sendo verificado — e vai para `.megabrain/blind-spots.md`
como temporária.

**Antes de concluir qualquer coisa, leia `.megabrain/blind-spots.md`:** sem ele você tenta algo
que não existe nesta máquina, vê nada acontecer e conclui errado.

## Referências

| Arquivo | Quando ler |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/card/references/playbooks/*.md` | o escolhido no roteador (§3), só ele |
| `${CLAUDE_PLUGIN_ROOT}/skills/card/references/flow-contract.md` | ao escrever ou corrigir um fluxo |
| `${CLAUDE_PLUGIN_ROOT}/skills/card/references/feature-contract.md` | ao escrever ou corrigir uma feature |
| `.megabrain/README.md` | **sempre**, antes do §2 |
| `.megabrain/blind-spots.md` | **sempre**, antes de concluir |
| `.megabrain/flows/README.md` | índice dos fluxos e a fila do que falta mapear |
| `.megabrain/flows/<fluxo>.md`, `.megabrain/features/<app>/<área>.md` | quando o `blast-radius` aponta em `LEIA ANTES` |
| `.megabrain/surfaces/<superfície>.md` | ao dirigir aquela superfície |
| `.megabrain/domain-pitfalls.md` | se existir: antes de afirmar algo sobre regra de domínio |
