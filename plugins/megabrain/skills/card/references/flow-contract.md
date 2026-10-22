# Fluxo: como mapear e o contrato de seções

Um fluxo é um processo de negócio dirigido de ponta a ponta no sistema rodando. Mora em
`.megabrain/flows/<nome>.md` do projeto; o índice e a fila ficam em `.megabrain/flows/README.md`.

## Como mapear

1. `blast-radius --files <arquivo do fluxo>` para achar superfícies e telas.
2. Subir só o que a saída mandou (`boot.mjs up ...`).
3. **Dirigir o fluxo inteiro**, do gatilho até a consequência financeira/fiscal.
4. Escrever `flows/<nome>.md` no **contrato de seções** abaixo: pré-condições primeiro
   (é onde as tentativas morrem), depois passos numerados com *asserção* em cada um.
5. Marcar `[provado]` só o que foi executado. `[não verificado]` é resposta aceitável.
6. **Declarar no topo o que o fluxo cobre**, para o `blast-radius` apontar para ele (exemplo do comanda10):
   ```
   ---
   covers:
     - apps/api/src/modules/order/useCases/cashRegisterAudit
     - apps/pdv/src/pages/closedCashRegisterAudit
   ---
   ```
   Prefixos de caminho — pasta do use case, da tela, do componente. Seja estreito: a
   pasta que só este fluxo usa, não `apps/pdv/src/pages/order` inteiro. Prefixo largo
   demais faz o fluxo aparecer em toda mudança, e aviso que sempre aparece ninguém lê.

7. **Deixar a fixture em SQL que roda, não em prosa.** Os dados da worktree nascem **zerados**:
   o `boot.mjs` cria o schema ou o banco, roda as migrations e o seed do projeto, sem nenhuma
   cópia dos dados do checkout principal. O seed dá o básico; tudo o mais (planos, configurações,
   cadastros que o fluxo exige) é fixture de mão, e é por onde cada rodada recomeça.

   Isso é de propósito — copiar os dados do checkout principal traria estado acumulado, e aí uma
   asserção passa ou falha por dado que ninguém sabe de onde veio. O preço é que a fixture morre
   junto com os dados da worktree.

   Então escreva cada pré-condição como **uma fixture que roda**: `.megabrain/fixtures/<nome>.sql`,
   aplicada com `boot.mjs seed <nome>` (`--check` roda e desfaz; as variáveis `:'nome'` vêm de
   `fixtures.vars` da config). Idempotente (`where not exists`, `on conflict do nothing`) e sem
   schema no nome das tabelas — o `seed` fixa o `search_path` da worktree. No fluxo fica só a
   linha do comando.

## Contrato de seções

Todo fluxo tem as mesmas H2, nesta ordem, para o agente achar a mesma informação no mesmo
lugar. Subtítulos (H3) dentro delas são livres.

| H2 | Obrigatória | O que vai |
|---|---|---|
| `## Contexto` | não | a estrutura de negócio ou de dados que explica o fluxo (ex.: as duas origens de balcão) |
| `## Pré-condições` | sim | tabela `# · pré-condição · onde / fixture · sintoma se faltar` |
| `## Passos` | sim | numerados, `[provado]` / `[não verificado]`, o comando `control.mjs` quando houver, e *Asserção:* em cada um; variantes (outra superfície, outro modo) em H3 |
| `## Onde encosta em dinheiro` | sim | caixa, pagamento, fiscal, estoque: o que grava e a consulta que confere |
| `## Não faça` | sim | armadilhas de negócio e de automação que custaram uma rodada |
| `## Prova` | sim | o que anexar ao report: a tabela mínima e o SQL de conferência |
| `## Não verificado` | sim | o que não foi dirigido — inclusive regra só lida no código, marcada assim |
| `## Onde vive` | não | arquivos por superfície |

O frontmatter `covers:` continua no topo; é o que o `blast-radius` lê.

**Um fluxo só está pronto quando o mapa diz onde ele encosta em dinheiro** — ou no efeito
equivalente do projeto (estoque, fiscal, cobrança). Fluxo que para no "salvou no banco" não foi mapeado.
