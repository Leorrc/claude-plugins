# Feature: o contrato

Uma feature diz como chegar e operar uma área de tela: o que dá para fazer ali, o caminho do
usuário, os comandos do `control.mjs` e o que trava. Um arquivo por área: `.megabrain/features/<app>/<área>.md`.
O fluxo diz o que acontece num processo que atravessa telas; uma feature serve a vários fluxos.

## Contrato

```markdown
---
covers:
  - apps/pdv/src/pages/<página>      # prefixos estreitos, como nos fluxos
---

# <App> → <Área>

Uma ou duas linhas: o que a área faz e a rota.

## Sub-features
- o que dá para fazer aqui, uma linha cada, com o fluxo que cobre (se houver)

## Como chegar (visão do usuário)
menu → item; o que precisa estar selecionado antes (estabelecimento, caixa, plano)

## Dirigir com control.mjs
os comandos, em ordem; `[provado]` só o que já rodou num fluxo ou report

## Armadilhas
o que trava, sem erro na tela, e como sair — com a fonte (card, fluxo, report)

### Lido no código, não dirigido
opcional: armadilha que o código mostra e ninguém dirigiu ainda, com o caminho do arquivo;
quem dirigir confirma e sobe para a lista de cima, ou apaga
```

