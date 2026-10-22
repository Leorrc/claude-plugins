# Playbook: why

"Por que isso é assim?" — responder com fonte, sem mudar código. Usado sozinho ou dentro
do `bug.md` para separar defeito de regra que mudou de propósito.

1. **Ache o trecho** que implementa a regra (`grep` pela mensagem, pelo campo, pela rota).
2. **Quem mudou e quando:**
   ```bash
   git log -L <início>,<fim>:<arquivo> --oneline     # a história daquelas linhas
   git log -S '<trecho literal>' --oneline           # quando o trecho apareceu/sumiu
   git blame -w -C <arquivo> -L <início>,<fim>
   ```
3. **O PR do commit:** `gh pr list --state merged --search <hash>` e `gh pr view <n>
   --json title,body,url`. O corpo costuma citar o card pelo id (`868…`).
4. **O card:** `clickup_get_task` + `clickup_get_task_comments` no id achado. A intenção
   costuma estar num comentário de suporte ou do produto, não na descrição.
5. **O fluxo:** se um fluxo de `.megabrain/flows/` cobre a regra, ele diz o que foi visto
   dirigindo — e se a regra é proposital ("não é regressão").
6. **Produção**, se houver acesso ao New Relic: a regra dispara com que frequência, com
   que erro. Sem acesso, diga que não olhou.

**Resposta:** a regra em uma frase, por que existe, desde quando, e as fontes (commit, PR,
card). Separe o que é **fato com fonte** do que é **inferência**. Sem fonte nenhuma: diga
isso — "o código faz X desde <commit>, sem PR nem card que explique" também é resposta.

No `bug.md`: commit recente e proposital que causa o sintoma → não é bug, é pedido de
mudança de regra. Pare e devolva para o dev com as fontes.
