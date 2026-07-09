# Pendencias para publicacao oficial

Esta lista controla o que ja foi concluido e o que ainda falta para transformar o prototipo em sistema oficial publicado.

## Concluido

- [x] Criar projeto oficial em Next.js.
- [x] Configurar Firebase Firestore.
- [x] Configurar Firebase Authentication com e-mail e senha.
- [x] Criar regras iniciais do Firestore para usuarios autenticados.
- [x] Criar tela de login e primeiro acesso.
- [x] Proteger paginas internas com login.
- [x] Aproximar layout oficial do visual combinado no prototipo.
- [x] Criar layout da preparacao do dia seguinte.
- [x] Criar layout do fluxo da oficina.
- [x] Preparar importacao de arquivo `.xls` e `.xlsx` da agenda.
- [x] Ler o formato real da planilha de agendamento em blocos por consultor.
- [x] Identificar cliente, veiculo, placa, chassi, telefone, consultor, horario, servico e observacoes.
- [x] Confirmar a data da agenda que sera preparada.
- [x] Identificar e sinalizar chassi duplicado.
- [x] Permitir apontar tecnico, prioridade, teste de rodagem e presenca do chefe/oficina.
- [x] Confirmar preparacao do veiculo.
- [x] Salvar preparacao confirmada no Firestore.
- [x] Criar registros em `appointments`, `preparations`, `vehiclesFlow` e `flowEvents`.
- [x] Fazer o fluxo carregar veiculos ativos do Firestore.
- [x] Mostrar veiculos confirmados no quadro `Preparacao Confirmada`.
- [x] Fazer a confirmacao individual da preparacao gravar no Firestore automaticamente.
- [x] Fazer o veiculo migrar para o fluxo do dia selecionado assim que for confirmado.
- [x] Remover a dependencia operacional do botao `Salvar preparacao`.
- [x] Mover chip de `Preparacao Confirmada` para `Aguardando Servico`.
- [x] Ao mover para `Aguardando Servico`, perguntar se o cliente ira aguardar na loja.
- [x] Registrar previsao de entrega prometida com data e hora.
- [x] Registrar tipo de lavagem.
- [x] Registrar observacao do recebimento.
- [x] Atualizar `vehiclesFlow` no Firestore ao mudar de etapa.
- [x] Registrar cada movimentacao em `flowEvents`.
- [x] Implementar regra que impede reduzir previsao de entrega.
- [x] Exibir historico de previsao de entrega no detalhe do chip.
- [x] Implementar movimentacao para `Em Servico`.
- [x] Implementar orcamento complementar com `Aguardando` e `Orcamento realizado`.
- [x] Registrar responsavel pelo orcamento complementar.
- [x] Registrar disponibilidade de pecas: Sim, Nao ou Parcial.
- [x] Registrar observacao de pecas.
- [x] Implementar movimentacao para lavagem.
- [x] Implementar preparacao de entrega.
- [x] Implementar entrega com prazo, pedido de peca, NPS e observacao futura.
- [x] Enviar veiculo entregue para pos-servico.
- [x] Implementar cadastro de passante.
- [x] Implementar NO-SHOW automatico para preparado nao recebido.
- [x] Implementar contato via WhatsApp pelo nome do cliente.
- [x] Implementar detalhe do chip com duplo clique.
- [x] Implementar ordenacao inteligente em `Aguardando Servico` e `Aguardando Lavagem`.
- [x] Persistir todos os dados operacionais no Firestore.
- [x] Conectar pos-servico aos veiculos entregues.
- [x] Criar permissoes por funcao no Firestore.
- [x] Criar area administrativa de usuarios.
- [x] Ocultar primeiro acesso apos criacao do administrador.
- [x] Importar planilha de status de registros HGSI.
- [x] Importar planilha de respostas HGSI.
- [x] Cruzar HGSI por chassi/O.S.
- [x] Criar indicadores reais no farol gerencial.

## Proximas prioridades

- [x] Publicar no GitHub.
- [x] Publicar na Vercel.
- [x] Configurar variaveis de ambiente na Vercel.
- [ ] Testar fluxo completo publicado.

## Regra de manutencao

Sempre que uma prioridade for concluida:

1. Marcar o item como concluido nesta lista.
2. Registrar qualquer nova pendencia encontrada.
3. Validar com `pnpm lint` e, quando houver alteracao funcional, `pnpm build`.
