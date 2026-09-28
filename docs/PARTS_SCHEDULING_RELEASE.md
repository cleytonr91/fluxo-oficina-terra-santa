# Pecas e agendamento: reativacao controlada

## Consultas e gravacoes

- Sem listeners de pedidos, veiculos relacionados ou migracoes nas duas paginas.
- Cada abertura/Atualizar/Carregar mais solicita ate 50 pedidos e ate 50 veiculos vinculados por ID. Nenhuma busca por placa percorre o historico de veiculos.
- Agendamento consulta apenas disponiveis com trackingState active. Concluidos usa consulta separada, explicitamente selecionada.
- Historico de Pecas somente por botao, em lotes de 50. Digitar nao aplica filtro; Pesquisar/Enter filtra os registros carregados, sem rede.
- Indicadores sao dos registros carregados. Carregar mais permite ampliar o conjunto; nao representar contagem parcial como total do banco.
- Abertura de acao de agendamento revalida um veiculo. Salvamento le um pedido em transacao e grava somente quando ha mudanca; tentativas de transacao podem repetir leituras.
- Salvar pedido compara os valores atuais antes de escrever. Nao sincroniza o portal publico durante a operacao limitada.
- Conclusao automatica por nova passagem removida do navegador. Conclusoes historicas continuam consultaveis; essa automacao nao foi reativada.
- Catalogo: uma leitura de metadados por sessao; blocos reutilizados localmente quando a versao coincide. Ate 100 blocos no primeiro carregamento/versao nova. Importacao identica nao grava; versao diferente grava ate 101 documentos atomicamente.
- Recebimento Mobis exige todos os lotes ativos carregados antes da classificacao, para nao distribuir pecas sobre uma fila parcial. Nao executa ao abrir a pagina.

## Orcamento de cota

Por lote: ate 100 leituras de dados, mais verificacoes das regras/perfil (estimativa conservadora de ate 151 leituras por lote). Zero escritas para abertura, pesquisa e navegacao. Nao ha multiplicacao por mudancas recebidas em listeners nem atualizacao periodica.

Exemplo conservador: 10 usuarios x 10 lotes/atualizacoes por dia x 151 = 15.100 leituras, sem incluir Fluxo, Pos-servico e outras rotinas. Isso limita cada acao, mas nao garante que o total da conta nunca ultrapasse sua cota.

## Compatibilidade e verificacao

Em 2026-09-28 UTC: agregacoes identificaram 121 pedidos, 27 sem trackingState. Manutencao explicita classificou somente esses 27: 10 ativos, 13 concluidos, 4 cancelados. Preservados os campos operacionais e timestamps. Script tests/parts-tracking-maintenance.cjs tem simulacao por padrao e exige --apply para gravar; usa precondicao de versao e nunca e importado pela aplicacao.

Consultas reais limitadas a um documento validaram os indices de disponiveis ativos e concluidos. Testes de regras usam recursos sinteticos, sem gravar clientes. Testes de navegador usam React real e servicos simulados em desktop/mobile, incluindo StrictMode, pesquisa confirmada e paginacao.

Publicar somente firestore.limited.rules; o arquivo firestore.rules possui alteracoes independentes e nao faz parte desta liberacao. Farol e demais paginas nao revisadas continuam suspensos.

## Medicao anterior

2026-09-28 00:48:15 a 00:58:15 UTC: 0 leituras nas amostras retornadas, nenhuma amostra de gravacao (nao significa zero), pico de 2 conexoes e 4 listeners. A manutencao e as verificacoes desta liberacao geram leituras adicionais e 27 gravacoes conhecidas; nao atribuir esse volume aos usuarios.
