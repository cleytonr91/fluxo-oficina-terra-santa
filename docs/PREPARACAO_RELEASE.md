# Preparação: publicação integrada

As melhorias de preparação devem permanecer no ramo principal junto ao cálculo local de no-show. A publicação isolada anterior foi substituída por um deploy Git que não continha essas alterações.

## Impacto no Firebase

- Importação, filtros, ordenação, distribuição por técnico, validação e chips responsivos usam a planilha em memória: zero consultas ou gravações adicionais.
- Preparação mantém uma leitura de documento e duas gravações na transação existente; roadTestRequired acompanha a gravação do veículo.
- Técnico ausente bloqueia o envio antes de acessar o banco.
- Recebimento mantém uma leitura e duas gravações; roadTestDone acompanha a atualização existente. Teste solicitado exige resposta booleana explícita.
- Nenhum listener, temporizador, coleção ou gravação automática foi acrescentado. Reconexões e usuários simultâneos não multiplicam novas consultas desta alteração.
- No-show continua sendo calculado localmente, conforme 6728d70.
- Não publicar regras locais neste release: as regras em produção já permitem os campos.

## Validação

Testes do fluxo incluem no-show, resposta Sim/Não e ausência de resposta, contagem de leituras/gravações e bloqueio sem técnico. Build de produção obrigatório antes da publicação. Conferir os arquivos publicados de Preparação e Fluxo após o deploy e registrar a comparação das métricas do Firebase; amostras recentes podem chegar com atraso.
