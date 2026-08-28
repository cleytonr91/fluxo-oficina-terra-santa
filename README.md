# Fluxo Oficina Terra Santa

Sistema operacional para preparação da agenda, acompanhamento do fluxo da oficina, pedidos de peças, agendamento de retorno, funilaria, pós-serviço HGSI e farol gerencial.

## Documentação principal

- [Lógica completa do sistema](docs/LOGICA_DO_SISTEMA.md)
- [Briefing técnico para apresentação à TI](docs/APRESENTACAO_TECNICA_TI.md)
- [Acesso de usuários](docs/ACESSO_USUARIOS.md)
- [Firebase e Firestore](docs/FIREBASE_FIRESTORE.md)
- [Checklist obrigatorio de cota do Firebase](docs/CHECKLIST_COTA_FIRESTORE.md)
- [Plano de integrações e coletas](docs/PLANO_INTEGRACOES_E_COLETAS.md)

## Tecnologias

- Next.js 16 e React 19
- Firebase Authentication e Firestore
- Vercel
- Leitura de Excel com SheetJS
- Leitura de PDF com PDF.js

## Execução local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Verificação

```bash
npm run lint
npm run build
```

As regras de negócio devem ser alteradas junto com o arquivo `docs/LOGICA_DO_SISTEMA.md`.

Toda atualização também deve passar pelo checklist de cota do Firebase antes da publicação.
