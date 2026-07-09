# MVP oficial - Fluxo da Oficina

## Objetivo

Criar um sistema web compartilhado para controlar o caminho do veículo desde a preparação do agendamento até o pós-serviço HGSI, com histórico, indicadores e responsabilidades claras por área.

## Primeira versão operacional

1. Login por usuário e perfil.
2. Cadastro de consultores, técnicos, chefe de oficina, líder de lavagem, estoquista, qualidade e gerente.
3. Importação da planilha Excel 97/2003 da agenda.
4. Preparação do dia seguinte com técnico, prioridade, teste de rodagem e confirmação.
5. Fluxo compartilhado com movimentação por etapas.
6. Registro de recebimento, previsão prometida, cliente aguardando e lavagem.
7. Controle de orçamento complementar com responsável, disponibilidade de peças e observação.
8. Entrega com prazo, pedido de peças, NPS interno e observação futura.
9. Pós-serviço com tratativas, pendências, aptidão e resposta HGSI.
10. Farol gerencial com volumes, prazos, no-show, consultor, técnico e qualidade.

## Perfis

- Chefe de oficina: prepara agenda e confirma entrada no fluxo.
- Consultor técnico: recebe cliente, acompanha fluxo e registra entrega.
- Mecânico: movimenta serviço e solicita orçamento complementar.
- Líder de posto: controla lavagem e preparação de entrega.
- Estoquista: registra orçamento complementar e disponibilidade de peças.
- Coordenador de qualidade: acompanha pós-serviço e HGSI.
- Gerente: acompanha indicadores e gargalos.

## Modelo de dados inicial no Firestore

### users

- id
- name
- email
- role
- active
- created_at

### appointments

- id
- imported_event_id
- appointment_date
- appointment_time
- client_name
- phone
- plate
- chassi
- model
- consultant_id
- service_type
- imported_notes
- source_file_name
- created_at

### preparations

- id
- appointment_id
- technician_id
- priority
- road_test_required
- chief_presence_required
- internal_note
- confirmed_at
- confirmed_by

### vehicles_flow

- id
- appointment_id
- origin
- current_lane
- customer_waits
- promised_delivery_at
- wash_type
- receive_note
- status
- created_at
- updated_at

### flow_events

- id
- vehicle_flow_id
- from_lane
- to_lane
- action_by
- action_note
- created_at

### complementary_budgets

- id
- vehicle_flow_id
- requested_by
- quoted_by
- part_availability
- parts_note
- status
- created_at
- completed_at

### deliveries

- id
- vehicle_flow_id
- delivered_at
- delivered_on_time
- parts_ordered
- internal_nps
- future_note
- created_by

### post_service_cases

- id
- vehicle_flow_id
- case_type
- pending_description
- treatment_status
- hgsi_request_allowed
- hgsi_request_status
- created_at
- updated_at

### hgsi_records

- id
- chassi
- os_number
- record_status
- is_valid_record
- source_file_name
- imported_at

### hgsi_answers

- id
- chassi
- os_number
- consultant_id
- answer_date
- nps
- installation_score
- deadline_score
- service_quality_score
- price_alignment_score
- wash_score
- correct_service
- source_file_name
- imported_at

## Decisões técnicas iniciais

- Aplicação: Next.js com App Router.
- Banco: Firebase Firestore.
- Autenticação: Firebase Auth.
- Importação Excel: processamento no servidor.
- Hospedagem: Vercel ou servidor equivalente.
- Histórico: toda movimentação importante gera registro em `flow_events`.
- Segurança: permissões por perfil antes de liberar uso real.
