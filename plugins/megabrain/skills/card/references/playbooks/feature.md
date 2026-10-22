# Playbook: feature

O roteiro de prova é o critério de aceite do card. Sem critério escrito, derive em poucas
linhas no checkpoint; não invente processo.

1. **Fonte das decisões.** A análise técnica no card (tech-decisions) fecha as escolhas:
   TL;DR, decisões, "O que precisa continuar valendo". Use-a como está. Sem análise, as
   escolhas pequenas são suas — registre cada uma em `## Decisões` do report, uma linha.
2. **Contradição com o sistema** (o card ou a análise pressupõe algo que o código não faz):
   pare e pergunte se muda o escopo; se não muda, siga pelo que o código faz e registre.
3. **Alcance antes de escrever:** `blast-radius --files` nos arquivos que você vai tocar.
   Contrato novo (API, tipos ou SDK compartilhados) mais app → é `multi-pr.md`.
4. **Implemente** pelo padrão do módulo que o CLAUDE.md do projeto descreve. Se o projeto tem
   skills de scaffolding (coluna, entidade), use-as: elas têm a ordem segura.
5. **Testes alvo** de cada use case novo ou mudado: um arquivo por vez.
6. **Prove** no nível que a §5 da SKILL manda: cada critério de aceite vira uma linha da
   tabela de prova; as asserções de `LEIA ANTES` e de "O que precisa continuar valendo"
   continuam passando.
7. **Regra nova ou mudada** → o fluxo que a cobre ganha a asserção nova no mesmo commit.
   Nenhum fluxo cobre e a área vai voltar a ser mexida → proponha mapear (fora do PR, se
   for grande).

Armadilhas de domínio que mais custam (agregado dono, matriz/filial, venda real vs.
pendência, contrato com clientes em produção): leia `.megabrain/domain-pitfalls.md`, se existir.
