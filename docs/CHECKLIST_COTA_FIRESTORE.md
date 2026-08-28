# Checklist de cota do Firebase

Este controle e obrigatorio em toda atualizacao do sistema. O objetivo e preservar o funcionamento no plano gratuito sem comprometer a atualizacao operacional entre os usuarios.

## 1. Inventario da alteracao

Registrar quais operacoes foram criadas ou modificadas:

- consultas pontuais com `getDoc` ou `getDocs`;
- listeners em tempo real com `onSnapshot`;
- criacoes, atualizacoes e exclusoes;
- transacoes e lotes;
- rotinas automaticas, temporizadores e efeitos React;
- recarregamentos, reconexoes e atualizacoes do PWA.

## 2. Estimativa minima

Para cada operacao, estimar:

```text
consumo diario = documentos por execucao
               x execucoes por usuario
               x usuarios simultaneos
               x repeticoes ou reconexoes previstas
```

Transacoes devem considerar as leituras e todas as gravacoes realizadas. Um listener deve considerar a carga inicial e cada documento alterado durante o periodo em que permanecer ativo.

## 3. Bloqueios de publicacao

A atualizacao nao deve ser publicada quando:

- uma gravacao automatica puder ser executada por todos os navegadores conectados;
- um efeito depender dos mesmos dados que ele altera e puder entrar em repeticao;
- uma consulta carregar toda a colecao sem necessidade operacional;
- listeners equivalentes forem abertos em mais de um componente;
- nao houver limite por data, status, pagina ou conjunto de identificadores;
- falhas de cota provocarem tentativas infinitas de reconexao ou repeticao.

## 4. Padrao preferencial

1. Calcular localmente estados derivados, como alertas e classificacoes, quando nao houver necessidade de persistencia.
2. Gravar apenas em uma acao real do operador.
3. Para automacoes persistentes, usar uma unica execucao no servidor, com idempotencia.
4. Consultar somente o dia, status ou registros exibidos na tela.
5. Compartilhar dados ja carregados entre indicadores e componentes.
6. Suspender novas tentativas quando o Firebase retornar `resource-exhausted`.

## 5. Validacao apos publicacao

Conferir no Firebase:

- leituras e gravacoes nas primeiras horas;
- pico de listeners e conexoes;
- erros `resource-exhausted`;
- horario de eventuais picos;
- colecoes responsaveis pelas operacoes.

Comparar com o periodo anterior. Caso haja crescimento sem justificativa operacional, reverter ou limitar a funcionalidade antes de continuar a evolucao.

## 6. Registro da verificacao

Toda entrega deve informar:

- operacoes afetadas;
- risco de cota: baixo, medio ou alto;
- protecoes aplicadas;
- resultado do build;
- resultado observado depois da publicacao, quando disponivel.
