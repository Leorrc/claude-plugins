# Playbook: multi-pr

Para card que mexe em contrato e em app, ou cujo TL;DR tem várias áreas. Um PR gigante
não se revisa; PRs na ordem de dependência se revisam e se provam um por um.

1. **Corte por contrato.** Ordem padrão:
   1. API + pacotes de contrato compartilhados (tipos, SDK) — contrato novo **aditivo**: campo
      opcional, query nova, nada removido. Os clientes em produção seguem funcionando com o
      contrato novo.
   2. Um PR por app que consome.
   3. Remoção do que ficou obsoleto, só depois dos apps no ar — muitas vezes outro card.
2. **Plano no report**, antes do primeiro commit: `## PRs` com uma linha por PR —
   escopo, branch, base, prova, estado (`[ ]` / `[link entregue]` / `[merged]`). Isso substitui
   qualquer roadmap; quem retoma lê essa lista.
3. **Branches empilhadas:** o primeiro sai de `main`; cada seguinte sai do anterior e o link
   de criação aponta para ele como base (`compare/<branch anterior>...<branch>`). Merge de
   baixo para cima.
4. **Cada PR se prova sozinho**, no nível da §5 da SKILL: o da API com teste de
   integração e o fluxo que consome o contrato ainda passando; cada app com
   as suas telas.
5. **Depois de um merge na base**, rebase dos de cima, `pnpm build:packages`,
   `migration:run` no schema da worktree, `doctor` de novo.

O corte é seu; diga no checkpoint quantos PRs e em que ordem. Se o card for menor do que
parecia, um PR só — diga isso também.
