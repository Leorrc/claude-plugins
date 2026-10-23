<p align="center">
  <img src="assets/dev10.png" width="220" alt="dev10">
</p>

<h1 align="center">Plugins do Claude Code</h1>

<p align="center">Os plugins da dev10 para o Claude Code.</p>

## megabrain

Trabalhe um card do ClickUp do link à branch provada no sistema rodando.

### Instalar

```
/plugin marketplace add pedidos10/claude-plugins
/plugin install megabrain@dev10
```

Depois `/reload-plugins`. Num projeto novo, rode `/megabrain:init` uma vez.

### Comandos

| Comando | O que faz |
| --- | --- |
| `/megabrain:card <link do card>` | Checkpoint "nas minhas palavras", playbook, implementação, prova dirigindo as superfícies e link de criação do PR. |
| `/megabrain:init` | Prepara o projeto: `.megabrain/config.json` e a base vazia. |
| `/megabrain:help` | Os comandos, os playbooks e os scripts; num projeto com `.megabrain/`, também as superfícies e os comandos de cada uma. |

### Onde fica cada coisa

O método e as ferramentas (`scripts/boot.mjs`, `scripts/control.mjs`, `scripts/blast-radius.mjs`) ficam
neste plugin. Cada projeto guarda a config e o conhecimento em `<repo>/.megabrain/`.

### Atualizar

`/plugin marketplace update dev10` e depois `/reload-plugins`.
