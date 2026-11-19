# Preparação compartilhada — implementação local

## Fluxo

A agenda é importada pelo chefe de oficina e salva por evento estável. Cada agendamento mantém três seções independentes: oficina, garantia e peças. Reimportar preserva o que foi salvo. Mudanças de data/cliente com o mesmo evento são rejeitadas para conferência.

Oficina define técnico, teste de rodagem e peças para reparo. Garantista registra manualmente a consulta externa, seleciona campanhas/recalls com TMO e peças. Peças seleciona modelo/ano e revisão do cardápio, completa código Apolo do cliente e confere a lista consolidada. Quantidades fracionadas são preservadas. Itens do cardápio sem código/quantidade precisam ser completados.

PDF: duas vias idênticas por A4, com nome, placa e peças/quantidades destacados. Listas extensas usam continuação em duas vias sem truncar. A geração atualiza a agenda escolhida uma vez para verificar alterações de outros setores. Mudanças de oficina/garantia invalidam a conferência anterior de peças.

## Acesso

Novo perfil garantista: Preparação. Estoquista ganha Preparação. Cada seção possui permissão separada nas regras do banco. Não há concessão automática de perfil a usuários existentes. Administradores atribuem o perfil usando a tela já existente.

## Impacto de cota

- Nenhum listener novo, temporizador, rotina automática de escrita ou consulta por digitação.
- Abrir a página, importar o arquivo local, filtrar e editar rascunhos: zero operações do novo módulo.
- Carregar/atualizar um dia: até 201 documentos lidos; mais de 200 bloqueia a lista parcial. Limite normalmente N agendamentos da data.
- Salvar importação: uma leitura e uma gravação por evento novo; reimportação idêntica uma leitura e zero gravações. Ao concluir, uma consulta do dia recupera os demais agendamentos já salvos.
- Salvar etapa: uma leitura e uma gravação; contador de versão por setor impede sobrescrita concorrente. Transações podem repetir leituras.
- Catálogo manual: até 101 leituras, bloqueia acima de 100. Salvar campanha: uma leitura e uma gravação.
- Enviar ao fluxo: duas leituras (preparação/veículo), até três gravações (veículo, histórico, status compartilhado); repetir não recria o veículo.
- Atualizar e gerar PDF: uma consulta do dia; renderização/download locais sem gravações.
- Regras consultam o perfil; essas leituras dependentes podem ser cobradas conforme a operação e cache da avaliação.
- Exemplo: 60 veículos, 3 setores, 4 atualizações por setor = aproximadamente 720 leituras de documentos/dia. Importação 120 leituras (60 + atualização 60), 60 gravações; 3 etapas por veículo = 180 leituras + 180 gravações; envio = 120 leituras + 180 gravações; um PDF do dia = 60 leituras. Total ilustrativo 1.200 leituras e 420 gravações, sem catálogo, perfil, retries e consultas de outros módulos.

## Publicação

Não publicado nesta implementação. Aplicar somente os dois novos blocos de coleções à versão corrente das regras, preservando alterações publicadas por outros trabalhos. Validar permissões sintéticas e build antes de liberar. Publicar o código integrado ao main, sem sobrescrever funcionalidades posteriores. Comparar métricas do Firebase após a publicação.

Campos ausentes do arquivo podem ser completados na etapa de Peças; código Apolo nunca é inferido a partir do número do evento. A origem real dos campos de código do cliente e ano deve ser conferida com uma exportação de exemplo antes da homologação operacional.

## Ajustes da preparação — catálogo, garantia e PDF

Código Apolo removido da interface, busca, validação e PDF; dados históricos não são apagados. Garantia aceita Ainda não conferido, Conferido sem Pendência, Garantia e Recall, preservando leitura de registros antigos. Peças avulsas de garantia/recall são somadas à separação.

O plano é sugerido localmente por modelo, motorização e ano, sem substituir escolhas salvas. Versões ambíguas exigem escolha. Sem ano, o usuário completa o campo antes de receber sugestões.

O preenchimento de peças reutiliza PartCatalogFields e loadCachedCatalog. Abrir a página não carrega o catálogo. O primeiro foco em um campo pode ler 1 metadado e até 100 blocos (limite existente de 70.000 itens); cache local da mesma versão evita os blocos e cache em memória compartilha a carga entre campos. Digitação e seleção são locais, sem gravações. Nenhum listener, temporizador de consulta ou escrita automática adicionado. Garantista recebe leitura do catálogo, sem permissão de alterá-lo.
