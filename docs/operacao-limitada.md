# Operacao limitada: Preparacao, Fluxo basico e Pos-servico

Ativada em codigo por `LIMITED_OPERATION`, em `src/lib/limited-operation.ts`.
Nenhum dado existente e apagado. Nao alterar o plano do Firebase.

## Aplicacao

- Somente Preparacao, Fluxo basico e Pos-servico, respeitando os perfis existentes.
- Login e troca obrigatoria de senha permanecem disponiveis.
- O bloqueio envolve a rota no layout: componentes de paginas suspensas nao sao montados nem iniciam seus efeitos.
- Perfis sem uma pagina habilitada recebem uma tela de operacao limitada, sem redirecionamento circular para login.
- Preparacao importa a agenda Excel localmente. Sem listeners, pesquisa de duplicidade por placa/chassi, veiculos anteriores, imobilizados ou pedidos de pecas.
- Inclusao explicita por botao: transacao le somente o ID do proprio agendamento para impedir que repeticoes sobrescrevam chips existentes. Nao pesquisa outros veiculos.
- Transacao cria apenas vehiclesFlow e flowEvents. Nao altera pedidos, nem cadastra lotes/appointments/preparations auxiliares.
- Pos-servico preserva quatro consultas por mes (entregues, registros, respostas e tratativas). Importacoes e tratativas continuam sendo gravacoes explicitas, nao automaticas.
- Etapa 1 do Fluxo em `BasicFlowBoard`: recebimento com horario real, tecnico obrigatorio ao iniciar, conclusao, orcamento com decisao manual, lavagem e entrega. Os chips existentes sao mantidos; nao ha migracao.
- Passantes, detalhes/historico, pecas/catalogo, imobilizacao editavel, antecipacao de lavagem e fichas/PDF ficam para etapas posteriores. Imobilizacao existente permanece visivel. A lavagem antecipada ja em andamento pode terminar e retornar ao servico.
- Nenhuma marcacao automatica de no-show, reparo em massa ou gravacao em temporizador. No-shows ja registrados podem ser recebidos normalmente.
- O componente completo nao e montado: nao basta esconder botoes enquanto seus efeitos continuam consultando.

## Medicao da etapa 1 (2026-09-25)

- Referencia do Monitoring, 09:37-10:37 UTC (06:37-07:37 BRT): 1 leitura, nenhuma gravacao reportada. Nao representa uma hora de operacao normal.
- Contagem agregada, sem baixar os documentos, as 10:46 UTC: 251 documentos com status ativo. Essa consulta de diagnostico tambem tem custo de leitura.
- Fluxo: 2 listeners limitados e disjuntos: status ativo (maximo 301, bloqueia acima de 300) e entregas da data por deliveredAt (maximo 101, bloqueia acima de 100). Inclui ativos anteriores/futuros na consulta inicial; futuras datas sao filtradas localmente. Nao afirmar que le apenas os chips do dia.
- Com 251 ativos, abertura custa aproximadamente 251 + entregas do dia, por sessao, mais perfil/regras/minimos. 10 sessoes com 20 entregas: cerca de 2.710 leituras iniciais. Trocar a data ou recarregar pode repetir essa carga.
- Mudancas sao recebidas por cada sessao conectada. 100 alteracoes vistas por 10 sessoes representam aproximadamente 1.000 leituras de alteracoes, com consumo adicional por entrada/saida das consultas, reconexoes e regras.
- Transicao: 1 leitura direcionada em transacao + 2 gravacoes (chip e auditoria). Entrega: 1 leitura + 3 gravacoes (inclui deliveries). Retries/regras podem acrescentar leituras. Nenhuma gravacao por abrir a pagina.
- Filtros de consultor e pesquisa sao locais. Nenhum listener de pecas, catalogo, historico ou colecao inteira sem filtro.
- Comparar intervalos de uma hora com quantidade de sessoes e movimentacoes. Metricas do projeto incluem Pos-servico e outros acessos privilegiados: nao atribuir tudo ao Fluxo nem a um usuario sem evidencia.
- Liberar uma familia de funcoes por vez, registrar horario e contagem de consultas/gravações, testar e comparar. Ordem proposta: passantes; detalhes com consulta sob demanda; resumo de pecas. Nao liberar automaticamente.

## Impacto na cota

Restauracao visual (2026-09-25): reutiliza AppHeader e classes originais do quadro/chips. Contadores, pesquisa, filtros e barras de prazo usam apenas os dados em memoria. O relogio e a atualizacao visual dos prazos nao consultam o banco. Permanecem os mesmos dois listeners; nenhum servico, regra ou gravacao foi alterado nesta restauracao. O indicador de entregas usa deliveredAt, sem buscar eventos para inferir conclusoes. Acoes suspensas nao aparecem no cabecalho.

- Abrir/importar arquivo/selecionar data na Preparacao: zero leituras de dados operacionais e zero gravacoes, fora a validacao normal do perfil no login.
- Adicionar 1 veiculo novo: normalmente 1 leitura de documento + 2 gravacoes. Repeticao: leitura do mesmo documento, sem novas gravacoes. Retries de transacao e leituras dependentes das regras podem acrescentar consumo.
- 100 novos veiculos: aproximadamente 100 leituras e 200 gravacoes, mais validacao de permissao/retries.
- Pos-servico: depende dos documentos retornados pelo mes e quantidade de aberturas. Nao e consumo zero.

## Publicacao e abas antigas

A publicacao do front-end nao interrompe JavaScript que ja estava carregado em outras maquinas. Todas as abas antigas precisam ser fechadas/reabertas. Para interromper imediatamente acessos antigos, publicar tambem as regras restritivas validadas; sem essa etapa, nao afirmar bloqueio de todas as consultas no banco.

Regras alternativas: `firestore.limited.rules`, configuracao `firebase.limited.json`. Guardar as regras anteriormente publicadas antes de trocar. A restricao rejeita novas consultas antigas; nao desfaz consumo ja ocorrido. Contas Admin SDK nao sao limitadas por regras Firestore e precisam de controle separado.

## Retorno

Restaurar regras anteriores verificadas e desativar LIMITED_OPERATION em uma publicacao coordenada. Conferir consumo antes e depois. Nao reexecutar importacoes automaticas ao restaurar.
