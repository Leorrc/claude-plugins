# Playbook: prototype

Para quando a pergunta só se responde vendo rodar: a análise técnica tem uma seção
"Decidir com protótipo", ou duas soluções parecem iguais no papel. Plano abstrato não
decide isso; uma versão que roda decide.

1. **A pergunta, as variantes, o critério.** Da seção do card ou, sem ela, escrita no
   checkpoint: o que se quer saber, 2–3 variantes, o que faz uma ganhar (legível na tela
   da tela a 1 m, cabe no fluxo sem clique a mais, query abaixo de X no seed…).
2. **Branch descartável** por variante (`<branch>-proto-a`, `-proto-b`). Código do mínimo
   que responde a pergunta: dado fixo, sem teste, sem migration se der para evitar. Nada
   disso vai para `main`.
3. **Rode cada variante** no sistema com `control.mjs` e grave a mesma evidência em todas
   (screenshot do mesmo ponto, o mesmo número medido).
4. **Compare contra o critério** no report: tabela variante × critério, com a evidência.
   Recomende uma, ou diga que o critério não separa e o que separaria.
5. **Entregue a decisão, não o código:** report + texto para o card com a recomendação e
   os screenshots. Sem PR. A implementação de verdade é outro card (ou o mesmo, depois
   da decisão), pelo `feature.md`.

Decisão de produto (qual variante o cliente prefere) não é sua: apresente a comparação e
pare.
