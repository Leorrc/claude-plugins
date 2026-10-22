# Playbook: bug

O objetivo é ver o defeito acontecer, corrigir, e ver o **mesmo roteiro** passar.

**No checkpoint, não proponha mudança além do sintoma do card.** Suspeita de defeito vizinho
lida só no código (outro módulo, emissão fiscal, outra tela) vai para `Dúvida` como hipótese a
reproduzir, não como escopo. Só entra no PR depois de reproduzida com o dado como o banco
entrega — teste com valor fabricado não conta (no 868mkba9u, o decimal vinha como `"0.00"`, e
o "defeito" da NFC-e lido no código não existia).

1. **Do sintoma ao arquivo.** O card diz a tela e o passo. Ache o arquivo suspeito pela
   rota da tela (`.megabrain/surfaces/` e `.megabrain/features/`) ou pelo texto da mensagem de erro (`grep`).
2. **Defeito ou regra que mudou?** Antes de "consertar", rode o `why.md` no trecho
   suspeito: se um PR recente mudou isso de propósito, o card é pedido de produto, não
   bug — pare e diga (é decisão de produto, §3 da SKILL).
3. **Raio do suspeito:** `blast-radius --files <arquivo>` diz o que subir e qual fluxo ler.
   Leia o fluxo, pré-condições primeiro: é onde as tentativas morrem. Mapa de código é
   **suspeito** — a divergência entre ele e o card costuma ser o próprio bug.
4. **Reproduza.** Dirija até o sintoma com `control.mjs`; confirme no banco, não só na tela.
   Grave o **roteiro mínimo** no report (pré-condições, passos, a asserção que falha).
   Ele é o contrato da correção.
5. **Não reproduziu?** Não conclua "não é bug". Varie os eixos que mais escondem defeito:
   origem do pedido, matriz ou filial, forma de pagamento e suas flags, caixa aberto e
   selecionado, permissão do usuário. Depois `blind-spots.md`: talvez o caminho não exista
   nesta máquina. Esgotou: entregue o report com o que tentou — é um bloqueio nomeado.
6. **Teste que falha primeiro.** Quando a regra cabe num use case ou componente, escreva o
   teste no padrão do projeto (CLAUDE.md: unitário ou de integração) e veja-o falhar.
7. **Corrija** no lugar dono da regra (a camada que o CLAUDE.md do projeto diz que é dona da regra).
8. **Prove:** o teste passa; o roteiro do passo 4 roda de novo e a asserção que falhava
   passa. Report com **Reprodução** e **Correção** lado a lado. Confira também as
   asserções dos fluxos em `LEIA ANTES` — a regressão que ninguém pediu.

Bug que se vê em um minuto na mão: pule a reprodução dirigida, vá direto ao teste que falha
(nível 0) e diga no checkpoint.
