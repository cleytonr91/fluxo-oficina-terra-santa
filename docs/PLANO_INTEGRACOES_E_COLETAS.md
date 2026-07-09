# Plano de integracoes e coletas

Este documento organiza os caminhos para acessar sistemas externos, coletar dados e alimentar o sistema oficial do fluxo da oficina.

## Objetivo

Reduzir tarefas repetitivas de consulta manual e transformar as informacoes de agenda, O.S. e pesquisas HGSI em dados para:

- Preparacao do dia seguinte.
- Fluxo da oficina.
- Pos-servico.
- Farol gerencial.

## Sistemas mapeados

### 1. ERP Linx Web / TS

URL inicial:

- http://linx-web.linhares.com.br/

Uso esperado:

- Acesso ao ERP da concessionaria.
- Apos login no Linx Web, acesso a um TS.
- Dentro do TS, acesso ao modulo operacional que solicita novo login.

Dados que queremos coletar:

- Numero da O.S.
- Consultor responsavel.
- Tecnico responsavel, quando disponivel.
- Data e hora de abertura.
- Data e hora de fechamento.
- Status da O.S.
- Tipo de servico.
- Pecas solicitadas.
- Pecas disponiveis ou pendentes.
- Valor de servicos e pecas, quando aplicavel.
- Informacoes de prazo e entrega.

Pontos a mapear durante navegacao guiada:

- Caminho exato apos o login no Linx Web.
- Nome do atalho ou modulo dentro do TS.
- Tela inicial do modulo.
- Caminho para localizar uma O.S.
- Se existe relatorio consolidado/exportacao.
- Filtros disponiveis por data, consultor, status ou placa.
- Se a coleta sera por planilha ou por consulta individual.

Observacoes:

- Login, senha, codigos e validacoes devem ser feitos pelo usuario.
- A automacao pode navegar e coletar dados apenas apos o acesso estar liberado.

Mapeamento inicial observado:

- URL apos redirecionamento: http://linx-web.linhares.com.br/software/html5.html
- Aplicacao carregada: Linx DMS v5.19 Evolutivo.
- Ambiente: HTML5 RDP / TS renderizado em canvas.
- Empresa/revenda exibida: TERRA SANTA - ARACAJU.
- Usuario exibido na barra inferior: CLEYTON.RO.
- Menus principais visiveis:
  - Atalho
  - Configuracao
  - CRM Plus
  - Faturamento
  - Financeiro
  - Oficina
  - Pecas
  - Veiculos
  - Relatorios
  - Controle de Materiais de Consumo
  - Gestao de Materiais de Consumo
  - Janela
  - Ajuda
- Limitacao tecnica: a tela do TS e renderizada principalmente em canvas, portanto a automacao nao consegue ler campos e menus como HTML comum. O mapeamento deve ser feito por observacao visual, cliques guiados e, quando possivel, exportacao de relatorios.

Tela de consulta/manutencao de O.S. observada:

- Janela: Manutencao da Ordem de Servico.
- Abas superiores da janela:
  - Consulta
  - Manutencao
- Bloco "Dados do Cliente":
  - Codigo do cliente.
  - Nome do cliente.
  - Botoes relacionados a check-in e cliente.
- Bloco "Dados do Veiculo":
  - Placa.
  - Frota.
  - Modelo.
  - Descricao.
  - Ano fabricacao.
  - Ano modelo.
  - Botoes "Troca Veiculo" e "Ficha".
- Abas internas da O.S.:
  - Dados Gerais
  - Outras Informacoes
  - Solicitacoes
  - Servicos
  - Pecas
  - Relatorios de Visita
  - Log de Alteracoes
  - Reimpressoes de O.S.
- Grade observada na aba de pecas/servicos:
  - Numero da linha.
  - Kit.
  - Codigo.
  - Descricao.
  - Quantidade.
  - Valor unitario.
  - Percentual de desconto.
  - Valor de desconto.
  - Tipo de servico.
  - Situacao.
  - Mecanico.
  - Romaneio.
  - Requisicao.
  - NF remessa.
  - Data remessa.
  - NF devolucao.
  - Data devolucao.
  - Percentual MVA.
- Totais observados:
  - Rentabilidade Pecas Externas.
  - Total Pecas Externas.
  - Rentabilidade Pecas Revisao.
  - Total Pecas Revisao.
  - Total de Pecas.
- Botoes operacionais visiveis:
  - Encerra O.S.
  - Fecha Lctos
  - Libera Lctos
  - Altera O.S.
  - Salva Alteracoes
  - Cancela O.S.
  - Exclui O.S.
  - Pecas/Servicos
  - Valorizacao
  - Reimprime O.S.

Dados ja considerados uteis para o Farol Gerencial a partir desta tela:

- Cliente.
- Placa.
- Modelo/descricao do veiculo.
- Ano do veiculo.
- Numero da O.S.
- Consultor responsavel.
- Tecnico/mecanico por item.
- TMOs lancados na aba Servicos.
- Valores de mao de obra na aba Servicos.
- Totais de servicos.
- Pecas aplicadas ou requisitadas.
- Quantidade de pecas.
- Valor unitario e total de pecas.
- Totais de pecas na aba Pecas.
- Requisicao e romaneio.
- Situacao do item.
- Indicativo de pecas externas/revisao.

Visao de resultado operacional desejada:

- Resultado diario da operacao.
- Vendas por consultor.
- Ticket medio por O.S. ou por consultor.
- TKM.
- Produtividade dos tecnicos.
- Separacao entre servicos/TMO e pecas.
- Total de mao de obra.
- Total de pecas.
- Total geral por O.S.
- Total geral por dia.
- Total por consultor.
- Total por tecnico/mecanico.

Regras de coleta por aba:

- Aba Servicos:
  - Coletar TMOs lancados.
  - Coletar descricao dos servicos.
  - Coletar tecnico/mecanico vinculado ao servico.
  - Coletar quantidade/tempo, quando disponivel.
  - Coletar valor unitario.
  - Coletar descontos.
  - Coletar total de servicos/mao de obra.
- Aba Pecas:
  - Coletar codigo da peca.
  - Coletar descricao da peca.
  - Coletar quantidade.
  - Coletar valor unitario.
  - Coletar descontos.
  - Coletar situacao.
  - Coletar tecnico/mecanico vinculado, quando aparecer.
  - Coletar requisicao e romaneio.
  - Coletar total de pecas.

Indicadores que o Farol deve gerar com esses dados:

- Faturamento de servicos por dia.
- Faturamento de pecas por dia.
- Faturamento total por dia.
- Faturamento por consultor.
- Faturamento por tecnico.
- Ticket medio por consultor.
- Ticket medio geral.
- TKM por consultor.
- TKM geral.
- Produtividade por tecnico.
- Participacao de pecas e servicos no total.
- O.S. sem TMO.
- O.S. sem peca.
- O.S. com peca sem servico ou servico sem peca.
- Descontos aplicados.

Pendencias de mapeamento nesta tela:

- Numero da O.S.: aba Dados Gerais.
- Consultor responsavel: aba Outras Informacoes.
- Identificar datas de abertura, fechamento e entrega.
- Identificar status geral da O.S.
- Identificar se existe botao ou relatorio para exportar a lista de O.S. do dia.
- Caminho ate a lista de O.S. do dia mapeado:
  1. Menu Oficina.
  2. Ordem de Servico.
  3. Manutencao.
  4. Na tela de filtro, clicar primeiro em Limpar para remover dados anteriores que possam atrapalhar a consulta.
  5. Usar o filtro Data de abertura da O.S.
  6. Informar data inicial desejada.
  7. Informar data final desejada.

### 2. Syonet

Uso esperado:

- Importar agenda de clientes para a preparacao do dia seguinte.

Pontos a mapear:

- URL de acesso.
- Caminho ate a agenda.
- Filtro por data.
- Exportacao em Excel/CSV.
- Campos disponiveis: cliente, telefone, placa, chassi, modelo, horario, servico, consultor e observacoes.
- Regras de duplicidade por chassi.

Resultado esperado:

- Criar importador "Agenda Syonet" na tela de preparacao.

Mapeamento inicial observado:

- URL apos login: https://linhares.syonet.com/portal/acessaSistema.do#/cic.do
- Tela inicial observada: Eventos.
- Menus superiores visiveis:
  - Vendas.
  - Pos vendas.
  - Marketing.
  - Gestao.
- Unidade exibida no topo: Terra Santa - Mossoro.
- Elementos visiveis na tela Eventos:
  - Pesquisa de clientes.
  - Pesquisa de evento.
  - Botao Filtros.
  - Etapas: Aguardando, Andamento, Sucesso, Insucesso.
  - Painel de eventos.
  - Filtros laterais: Funil, Etapas do funil, Tipos evento, Origens, Midias, Modelos de interesse, Motivos insucesso, Motivos andamento, Empresas, Temperatura, Tipo de acao.
  - Seletor inferior de visualizacao: Listagem de eventos.
  - Ordenacao por Data Proximo Contato.

Pontos ainda a mapear no Syonet:

- Caminho inicial ate relatorios:
  1. Gestao.
  2. Relatorios.
- Caminho exato dentro do menu lateral de Relatorios:
  1. Relatorios.
  2. Agendamentos.
  3. Lista Evento Agendamento.
- Filtros usados para data do agendamento:
  - Empresa: Aracaju.
  - Data inicial: dia seguinte desejado.
  - Data final: mesmo dia da data inicial.
  - Exemplo:
    - Data inicial: 10/07/2026.
    - Data final: 10/07/2026.
- Unidade correta para Terra Santa - Aracaju, se diferente da exibida inicialmente.
- Se existe exportacao de listagem.
- Formato exportado: `.xls`, `.xlsx` ou `.csv`.
- Padrao de nome do arquivo exportado.

Exportacao do relatorio Lista Evento Agendamento:

- A exportacao fica na parte superior da tela do relatorio.
- Para gerar o arquivo, clicar no icone desejado.
- Para o nosso uso, clicar no icone do Excel.
- O arquivo exportado e baixado na pasta Downloads do usuario.
- Este arquivo deve alimentar a preparacao do dia seguinte.

### 3. Route HGSI - Status Registro

Uso esperado:

- Identificar registros validos, carencia, filtros metodologicos e clientes aptos para pesquisa.

Pontos a mapear:

- URL de acesso.
- Caminho ate Status Registro.
- Filtros de concessionaria e periodo.
- Exportacao da planilha.
- Campos usados para cruzamento: chassi, O.S., status, passagem, consultor e validade do registro.

Resultado esperado:

- Alimentar a pagina de Pos-servico e a regra de aptidao para pesquisa HGSI.

Mapeamento inicial observado no portal Route HGSI:

- URL base observada apos acesso: https://routepesquisa.com.br/hgsi/HomeV2
- Portal: PORTAL HGSI | Hyundai Global Satisfaction Index.
- Tela observada: Dashboard.
- Concessionaria exibida: 19044-Terra Santa - Aracaju.
- Periodo exibido no dashboard observado: JULHO/2026 - Vendas - Mensal - Periodo do campo: 24/06/2026 a 23/07/2026.
- Observacao operacional: a tela inicial observada estava filtrada como Vendas. Para o projeto, deve-se usar o botao Filtros e alterar a area/processo para Pos-Vendas antes de consultar ou exportar dados.
- Dashboard Pos-Vendas observado apos ajuste de filtros:
  - URL: https://routepesquisa.com.br/hgsi/HomeV2/Index
  - Titulo da aba: Dashboard - Concessionaria - 19044-Terra Santa - Aracaju - JULHO/2026 - Pos-Vendas - Mensal - Periodo do campo: 07/07/2026 a 06/08/2026.
  - Botao Filtros visivel no canto superior direito.
  - Botao Exportar nao ficou visivel nesta captura do dashboard Pos-Vendas, diferente da tela inicial de Vendas.
  - Indicadores visiveis:
    - Recomendacao Marca.
    - Recomendacao Concessionaria.
    - Recomendacao Consultor.
    - Recomendacao Concessionaria YTD.
    - Indice HGSI.
    - Qualidade da Base.
    - Evolutivo - Recomendacao Hyundai.
    - Evolutivo - Recomendacao Concessionaria.
    - Lavagem.
    - Servico Correto na 1a Visita.
    - Evolutivo HGSI.
    - Pesquisas.
    - Ranking.
  - Qualidade da Base exibida:
    - Recebidos.
    - Entregues.
    - Aproveitamento.
  - Pesquisas exibidas:
    - Realizadas.
    - Cota.
    - Recomendacao Concessionaria REG.
  - Ranking exibido:
    - Regional.
    - Nacional.
- Botoes visiveis:
  - Exportar.
  - Filtros.
- Indicadores visiveis no dashboard:
  - Recomendacao Concessionaria.
  - Evolucao Mensal.
  - Recomendacao Consultor.
  - Indice HGSI.
  - Status de Campo.
  - Recomendacao Marca.
  - Qualidade da Base.
- Status de campo observado:
  - Cota.
  - Pesquisas realizadas.
  - Ranking nacional.
  - Ranking regional.

Pontos a mapear no Route HGSI:

- Caminho pelo menu lateral ate Status Registro.
- Caminho pelo menu lateral ate Acompanhamento das Entrevistas.
- Como aplicar filtros de area: Pos-Vendas.
- Como aplicar filtro de concessionaria: 19044-Terra Santa - Aracaju.
- Como aplicar periodo.
  - Se o botao Exportar baixa Excel diretamente ou abre selecao de formato.
  - Nome padrao dos arquivos exportados.
  - Se a exportacao respeita exatamente os filtros da tela.

Status Registro - exportacao confirmada:

- O usuario acessou a tela Status Registro no Route HGSI.
- Caminho de menu:
  1. Relatorio online.
  2. Status de registro.
- Foi possivel exportar arquivo em `.xls`.
- Arquivo observado na pasta Downloads:
  - `Modelo - Status Registro09-07-2026 - 15-31-52.xls`
- Padrao de nome observado:
  - `Modelo - Status RegistroDD-MM-AAAA - HH-MM-SS.xls`
  - O arquivo e intitulado com a data do dia da exportacao e horario.
- Este formato deve alimentar a importacao de Status Registro ja prevista no Pos-servico.
- Caminho operacional ainda a detalhar:
  - Confirmar visualmente o botao exato de exportacao na tela Status Registro, se necessario.
  - Se o periodo exportado segue o periodo do dashboard Pos-Vendas.

Filtros usados no Status Registro:

- Seguem o mesmo filtro definido no inicio da sessao do Route HGSI:
  - Area/processo: Pos-Vendas.
  - Concessionaria: 19044-Terra Santa - Aracaju.
  - Periodo desejado.

### 4. Route HGSI - Acompanhamento das Entrevistas

Uso esperado:

- Coletar respostas das pesquisas da montadora.

Pontos a mapear:

- Caminho ate Acompanhamento das Entrevistas:
  1. Relatorios online.
  2. Entrevistas.
- Filtros de periodo.
- Exportacao da planilha.
- Campos de nota: instalacoes, consultor, prazos, qualidade dos servicos, alinhamento de precos, lavagem, NPS e servico correto.

Resultado esperado:

- Cruzar resposta HGSI com termometro interno, tratativas e fluxo operacional.

Mapeamento confirmado:

- A tela Entrevistas permite visualizar as respostas dos clientes a pesquisa HGSI.
- A tela segue os mesmos filtros definidos no inicio da sessao do Route HGSI:
  - Area/processo: Pos-Vendas.
  - Concessionaria: 19044-Terra Santa - Aracaju.
  - Periodo desejado.
- E possivel realizar exportacao do arquivo.
- Arquivos de exemplo ja observados:
  - `Acompanhamento das Entrevistas - Pós Vendas - 07-07-2026 - 15-27-02.xls`
  - `Acompanhamento das Entrevistas - Pós Vendas - 07-07-2026 - 15-25-31.xls`
- Esta fonte deve alimentar:
  - Pesquisas respondidas por consultor.
  - Notas por indicador.
  - Comparativo entre termometro interno e resposta real HGSI.
  - Impacto de tratativas ou pendencias na nota final.
  - Farol gerencial por consultor e indicador.

## Frequencia sugerida

- Agenda: diariamente, no fim do expediente, para preparar o dia seguinte.
- O.S.: fechamento do dia ou atualizacoes ao longo do dia.
- Status Registro HGSI: diariamente.
- Respostas HGSI: diariamente ou duas vezes ao dia.

## Proximo passo

Mapear o ERP Linx Web / TS em navegacao guiada:

1. Usuario acessa o Linx Web e realiza login.
2. Usuario abre o TS.
3. Usuario realiza login no modulo interno.
4. Codex acompanha a navegacao e registra o caminho ate consulta/exportacao de O.S.
5. Definir se a coleta sera por exportacao ou por automacao assistida de telas.
