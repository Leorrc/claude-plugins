# dev10 — plugins do Claude Code

## megabrain

Trabalhe um card do ClickUp do link à branch provada no sistema rodando.

```
/plugin marketplace add pedidos10/claude-plugins
/plugin install megabrain@dev10
```

- `/megabrain:card <link do card>` — checkpoint "nas minhas palavras", playbook, implementação,
  prova dirigindo as superfícies, link de criação do PR.
- `/megabrain:init` — prepara um projeto (`.megabrain/config.json` + base vazia).
- `/megabrain:help` — os comandos, os playbooks e os scripts; num projeto com `.megabrain/`,
  também as superfícies e os comandos de cada uma.

O método e as ferramentas (`scripts/boot.mjs`, `scripts/control.mjs`, `scripts/blast-radius.mjs`)
ficam aqui; cada projeto guarda config e conhecimento em `<repo>/.megabrain/`.
