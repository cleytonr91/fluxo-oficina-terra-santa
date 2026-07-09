# Banco de dados

O sistema oficial usa PostgreSQL. O schema inicial está em `db/migrations/001_initial_schema.sql` e foi desenhado para manter o histórico do veículo, não apenas o estado atual do chip.

## Como subir localmente

Requisitos:

- Docker Desktop instalado.

Comandos:

```powershell
pnpm db:up
```

O banco local ficará em:

```text
postgresql://fluxo_user:fluxo_password@localhost:5432/fluxo_oficina
```

Copie `.env.example` para `.env.local` quando a aplicação começar a conectar no banco.

Para apagar o banco local e recriar do zero:

```powershell
pnpm db:reset
```

Para parar o banco:

```powershell
pnpm db:down
```

## Tabelas principais

- `users`: equipe e perfis.
- `import_batches`: cada planilha importada.
- `appointments`: agenda importada do Excel.
- `preparations`: atuação do chefe de oficina antes do fluxo.
- `vehicles_flow`: estado atual do veículo.
- `flow_events`: histórico de movimentações.
- `complementary_budgets`: orçamento complementar e peças.
- `deliveries`: fechamento da entrega.
- `post_service_cases`: tratativas e aptidão HGSI.
- `hgsi_records`: registros válidos da montadora.
- `hgsi_answers`: respostas de pesquisa HGSI.

## Regra central

`appointments` guarda o que veio da agenda. Quando a preparação é confirmada, o sistema cria um registro em `vehicles_flow` e toda movimentação posterior gera um registro em `flow_events`.

Isso permite medir tempo parado por etapa, responsável pela movimentação, no-show, atrasos, pendências, entrega e reflexo no pós-serviço.
