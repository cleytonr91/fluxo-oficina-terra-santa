# Regras obrigatorias de manutencao

## Cota do Firebase

Toda alteracao deve ser avaliada quanto ao impacto na cota diaria do Firebase antes de ser publicada.

Checklist obrigatorio:

1. Identificar todas as consultas, listeners, transacoes e gravacoes adicionadas ou alteradas.
2. Estimar a multiplicacao por documentos retornados, usuarios simultaneos, reconexoes e repeticoes durante o dia.
3. Verificar se algum `useEffect`, listener, temporizador ou renderizacao pode iniciar gravacoes automaticas.
4. Impedir que varios navegadores executem a mesma rotina automatica. Preferir calculo local; quando a persistencia for indispensavel, usar execucao unica e idempotente no servidor.
5. Evitar listeners de colecoes inteiras. Consultas em tempo real devem ser filtradas pelo menor periodo e conjunto de documentos necessarios.
6. Reaproveitar dados ja carregados em vez de abrir consultas equivalentes em componentes diferentes.
7. Executar build e revisar o diff antes da publicacao.
8. Depois da publicacao, conferir leituras, gravacoes, conexoes e listeners no Firebase, comparando com o comportamento anterior.

Uma alteracao nao esta concluida se o impacto de cota nao tiver sido analisado. Se o impacto nao puder ser estimado com seguranca, nao publicar ate instrumentar ou limitar a operacao.
