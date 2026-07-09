create extension if not exists pgcrypto;

create type user_role as enum (
  'admin',
  'gerente',
  'chefe_oficina',
  'consultor',
  'tecnico',
  'lider_lavagem',
  'estoquista',
  'qualidade'
);

create type service_type as enum (
  'revisao_01',
  'revisao_02',
  'revisao_03',
  'revisao_04',
  'revisao_05',
  'revisao_06',
  'revisao_07',
  'revisao_08',
  'revisao_09',
  'revisao_10',
  'diagnostico',
  'reparo_geral',
  'recall',
  'combinado'
);

create type priority_level as enum ('normal', 'alta');

create type flow_lane as enum (
  'preparacao_confirmada',
  'aguardando_servico',
  'em_servico',
  'orcamento_complementar',
  'aguardando_lavagem',
  'lavagem',
  'preparacao_entrega',
  'entregue'
);

create type vehicle_origin as enum ('agendado', 'passante');
create type wash_type as enum ('simples', 'motor', 'motor_bancos', 'nao');
create type part_availability as enum ('sim', 'nao', 'parcial');
create type budget_status as enum ('aguardando', 'realizado', 'cancelado');
create type post_case_type as enum ('solicitar_hgsi', 'tratar_antes_pesquisa', 'nao_solicitar', 'fora_base', 'pendencia_acordada');
create type treatment_status as enum ('aberto', 'em_tratativa', 'tratado', 'sem_acao');
create type hgsi_request_status as enum ('nao_solicitada', 'solicitada', 'respondida', 'bloqueada');

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  role user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_kind text not null,
  imported_by uuid references users(id),
  imported_at timestamptz not null default now(),
  total_rows integer not null default 0,
  notes text
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references import_batches(id) on delete set null,
  imported_event_id text,
  appointment_date date not null,
  appointment_time time,
  client_name text not null,
  phone text,
  plate text not null,
  chassi text,
  model text,
  consultant_id uuid references users(id),
  service_type service_type not null,
  imported_notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (imported_event_id)
);

create table preparations (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  technician_id uuid references users(id),
  priority priority_level not null default 'normal',
  road_test_required boolean not null default false,
  chief_presence_required boolean not null default false,
  internal_note text,
  confirmed_at timestamptz,
  confirmed_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vehicles_flow (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid unique references appointments(id) on delete set null,
  origin vehicle_origin not null default 'agendado',
  current_lane flow_lane not null default 'preparacao_confirmada',
  customer_waits boolean not null default false,
  promised_delivery_at timestamptz,
  wash_type wash_type not null default 'simples',
  receive_note text,
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table walk_in_customers (
  id uuid primary key default gen_random_uuid(),
  vehicle_flow_id uuid not null unique references vehicles_flow(id) on delete cascade,
  client_name text not null,
  phone text,
  plate text not null,
  chassi text,
  model text,
  consultant_id uuid references users(id),
  technician_id uuid references users(id),
  service_type service_type not null default 'reparo_geral',
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table flow_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_flow_id uuid not null references vehicles_flow(id) on delete cascade,
  from_lane flow_lane,
  to_lane flow_lane not null,
  action_by uuid references users(id),
  action_note text,
  created_at timestamptz not null default now()
);

create table complementary_budgets (
  id uuid primary key default gen_random_uuid(),
  vehicle_flow_id uuid not null references vehicles_flow(id) on delete cascade,
  requested_by uuid references users(id),
  quoted_by uuid references users(id),
  part_availability part_availability,
  parts_note text,
  status budget_status not null default 'aguardando',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  vehicle_flow_id uuid not null unique references vehicles_flow(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  delivered_on_time boolean,
  parts_ordered boolean not null default false,
  internal_nps integer check (internal_nps between 0 and 10),
  future_note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table post_service_cases (
  id uuid primary key default gen_random_uuid(),
  vehicle_flow_id uuid not null references vehicles_flow(id) on delete cascade,
  case_type post_case_type not null,
  pending_description text,
  treatment_status treatment_status not null default 'aberto',
  hgsi_request_allowed boolean not null default true,
  hgsi_request_status hgsi_request_status not null default 'nao_solicitada',
  assigned_to uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hgsi_records (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references import_batches(id) on delete set null,
  chassi text not null,
  os_number text not null,
  record_status text not null,
  is_valid_record boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (chassi, os_number, record_status)
);

create table hgsi_answers (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references import_batches(id) on delete set null,
  chassi text,
  os_number text,
  consultant_id uuid references users(id),
  answer_date date,
  nps integer check (nps between 0 and 10),
  installation_score numeric(4,2),
  deadline_score numeric(4,2),
  service_quality_score numeric(4,2),
  price_alignment_score numeric(4,2),
  wash_score numeric(4,2),
  correct_service boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create index appointments_date_idx on appointments (appointment_date, appointment_time);
create index appointments_plate_idx on appointments (plate);
create index appointments_chassi_idx on appointments (chassi);
create index vehicles_flow_lane_idx on vehicles_flow (current_lane);
create index flow_events_vehicle_created_idx on flow_events (vehicle_flow_id, created_at desc);
create index post_service_status_idx on post_service_cases (treatment_status, case_type);
create index hgsi_records_chassi_valid_idx on hgsi_records (chassi, is_valid_record);
create index hgsi_answers_chassi_os_idx on hgsi_answers (chassi, os_number);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

create trigger appointments_set_updated_at
before update on appointments
for each row execute function set_updated_at();

create trigger preparations_set_updated_at
before update on preparations
for each row execute function set_updated_at();

create trigger vehicles_flow_set_updated_at
before update on vehicles_flow
for each row execute function set_updated_at();

create trigger post_service_cases_set_updated_at
before update on post_service_cases
for each row execute function set_updated_at();
