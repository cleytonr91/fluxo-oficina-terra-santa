# Acesso de usuários

## Estado atual

O sistema já usa Firebase Authentication com e-mail e senha.

- Visitantes são enviados para `/login`.
- Usuários autenticados acessam início, preparação, fluxo, pós-serviço e farol gerencial.
- O perfil operacional fica salvo na coleção `users`.
- O cabeçalho mostra nome, função e botão de saída.

## Primeiro acesso

Nesta fase inicial, a tela `/login` possui a aba `Primeiro acesso`.

Ela cria:

1. Usuário no Firebase Authentication.
2. Perfil na coleção `users`.
3. Função operacional escolhida no formulário.

Funções disponíveis:

- Administrador
- Gerente
- Chefe de oficina
- Consultor técnico
- Mecânico
- Líder de posto
- Estoquista
- Coordenador de qualidade

## Ajuste antes do uso oficial

Antes de liberar para toda a equipe, o ideal é transformar o primeiro acesso em uma tela administrativa.

Fluxo recomendado:

1. Criar o primeiro administrador.
2. Ocultar o botão `Primeiro acesso`.
3. Criar uma página `Usuários`.
4. Permitir que apenas administrador ou gerente cadastre novos usuários.
5. Refinar as regras do Firestore por função.

## Próxima regra de permissão

Hoje as coleções operacionais permitem leitura e escrita para usuários autenticados. A próxima etapa é restringir ações por função.

Exemplo:

- Chefe de oficina: prepara agenda e confirma preparação.
- Consultor técnico: recebe, movimenta, entrega e finaliza dados do atendimento.
- Mecânico: movimenta serviço e orçamento complementar.
- Líder de posto: movimenta lavagem.
- Estoquista: conclui orçamento de peças.
- Qualidade: trata pós-serviço e HGSI.
- Gerência: consulta farol gerencial e indicadores.
