# Firebase Firestore

O sistema oficial seguirá com Firebase Firestore como banco compartilhado, usando Vercel para publicação e GitHub para versionamento.

## Projeto configurado

- Projeto Firebase: `fluxo-oficina-terra-santa`.
- Firestore: banco `(default)` criado em `southamerica-east1 (São Paulo)`.
- Modo do Firestore: produção.
- Firebase Auth: provedor `E-mail/senha` ativado.
- App Web: `sistema-oficial`.

## Serviços Firebase

- Firestore: banco de dados operacional.
- Firebase Auth: login e perfil de usuários.
- Firebase Storage: opção futura para guardar planilhas importadas, se necessário.

## Variáveis necessárias

Crie um arquivo `.env.local` baseado em `.env.example`:

```text
NEXT_PUBLIC_FIREBASE_API_KEY=""
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=""
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=""
NEXT_PUBLIC_FIREBASE_APP_ID=""
```

Esses valores vêm do painel do Firebase em:

```text
Configurações do projeto > Seus apps > App Web
```

## Arquivos de configuração

- `firebase.json`: aponta os arquivos oficiais do Firestore.
- `firestore.rules`: regras iniciais de segurança, publicadas no Console Firebase.
- `firestore.indexes.json`: índices para consultas do fluxo, pós-serviço e HGSI.

As regras iniciais permitem leitura e escrita nas coleções operacionais apenas para usuários autenticados. A coleção `users` fica separada para evitar alteração indevida de perfis. A próxima evolução será restringir por função: chefe de oficina, consultor, mecânico, líder de posto, estoquista, qualidade e gestão.

## Coleções

As coleções ficam definidas em `src/lib/firebase/collections.ts`.

- `users`
- `importBatches`
- `appointments`
- `preparations`
- `vehiclesFlow`
- `walkInCustomers`
- `flowEvents`
- `complementaryBudgets`
- `deliveries`
- `postServiceCases`
- `hgsiRecords`
- `hgsiAnswers`

## Regras de modelagem

Firestore não trabalha como SQL. Então vamos gravar documentos já preparados para leitura operacional.

- `appointments` guarda a agenda importada.
- `preparations` guarda a preparação feita pelo chefe de oficina.
- `vehiclesFlow` guarda o estado atual do chip.
- `flowEvents` guarda o histórico de movimentos.
- `deliveries` guarda o fechamento da entrega.
- `postServiceCases` guarda tratativas e pendências.

## Próximas etapas

1. Criar a tela de login com Firebase Auth.
2. Criar o primeiro usuário administrador.
3. Publicar regras e índices do Firestore.
4. Criar importação real da planilha para `appointments`.
5. Fazer a preparação confirmada criar ou atualizar `vehiclesFlow`.
