# Operacao limitada: Preparacao e Pos-servico

Ativada em codigo por `LIMITED_OPERATION`, em `src/lib/limited-operation.ts`.
Nenhum dado existente e apagado. Nao alterar o plano do Firebase.

## Aplicacao

- Somente Preparacao e Pos-servico, respeitando os perfis existentes.
- Login e troca obrigatoria de senha permanecem disponiveis.
- O bloqueio envolve a rota no layout: componentes de paginas suspensas nao sao montados nem iniciam seus efeitos.
- Perfis sem uma pagina habilitada recebem uma tela de operacao limitada, sem redirecionamento circular para login.
- Preparacao importa a agenda Excel localmente. Sem listeners, pesquisa de duplicidade por placa/chassi, veiculos anteriores, imobilizados ou pedidos de pecas.
- Inclusao explicita por botao: transacao le somente o ID do proprio agendamento para impedir que repeticoes sobrescrevam chips existentes. Nao pesquisa outros veiculos.
- Transacao cria apenas vehiclesFlow e flowEvents. Nao altera pedidos, nem cadastra lotes/appointments/preparations auxiliares.
- Pos-servico preserva quatro consultas por mes (entregues, registros, respostas e tratativas). Importacoes e tratativas continuam sendo gravacoes explicitas, nao automaticas.

## Impacto na cota

- Abrir/importar arquivo/selecionar data na Preparacao: zero leituras de dados operacionais e zero gravacoes, fora a validacao normal do perfil no login.
- Adicionar 1 veiculo novo: normalmente 1 leitura de documento + 2 gravacoes. Repeticao: leitura do mesmo documento, sem novas gravacoes. Retries de transacao e leituras dependentes das regras podem acrescentar consumo.
- 100 novos veiculos: aproximadamente 100 leituras e 200 gravacoes, mais validacao de permissao/retries.
- Pos-servico: depende dos documentos retornados pelo mes e quantidade de aberturas. Nao e consumo zero.

## Publicacao e abas antigas

A publicacao do front-end nao interrompe JavaScript que ja estava carregado em outras maquinas. Todas as abas antigas precisam ser fechadas/reabertas. Para interromper imediatamente acessos antigos, publicar tambem as regras restritivas validadas; sem essa etapa, nao afirmar bloqueio de todas as consultas no banco.

Regras alternativas: `firestore.limited.rules`, configuracao `firebase.limited.json`. Guardar as regras anteriormente publicadas antes de trocar. A restricao rejeita novas consultas antigas; nao desfaz consumo ja ocorrido. Contas Admin SDK nao sao limitadas por regras Firestore e precisam de controle separado.

## Retorno

Restaurar regras anteriores verificadas e desativar LIMITED_OPERATION em uma publicacao coordenada. Conferir consumo antes e depois. Nao reexecutar importacoes automaticas ao restaurar.
