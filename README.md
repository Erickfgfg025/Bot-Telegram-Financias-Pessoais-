# Íris 💜 | Finanças pessoais no Telegram

A Íris é uma assistente de finanças pessoais para Telegram, com Supabase como banco e backend. O projeto começa priorizando serviços gratuitos e não ativa recursos pagos automaticamente.

## O que a arquitetura prevê

- Registro de receitas, despesas e transferências.
- Contas, categorias, orçamentos, metas, dívidas e pagamentos.
- Lançamentos recorrentes, parcelamentos e lembretes.
- Relatórios calculados a partir do PostgreSQL, nunca estimados pelo modelo de IA.
- Conversa contextual, histórico recente, resumos e memória semântica com pgvector.
- Entrada por texto primeiro; voz e provedores de IA são etapas posteriores com fallback quando indisponíveis.
- Isolamento por usuário, idempotência de atualizações do Telegram e segredos somente no Supabase.

## Estado atual

- Projeto Supabase criado na região São Paulo.
- Esquema inicial aplicado e tabelas verificadas.
- O webhook ainda exige configuração dos segredos do Telegram antes de poder atender mensagens.
- IA externa, embeddings, voz, lembretes agendados e relatórios completos ainda não estão ativados.

## Configuração

1. Configure os segredos TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET nas configurações de secrets das Edge Functions do Supabase.
2. Confira se SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY estão disponíveis para a função no ambiente de execução. Nunca coloque a chave service role neste repositório.
3. Faça deploy da função telegram-webhook.
4. Configure o webhook do bot no Telegram usando a URL da função e o mesmo valor de TELEGRAM_WEBHOOK_SECRET no parâmetro secret_token.
5. Teste primeiro com mensagens sem dados financeiros e depois com lançamentos pequenos.

## Segurança

- Não commite tokens, chaves, arquivos .env ou dados financeiros reais.
- O acesso ao banco é feito no servidor com service role; não exponha essa chave no cliente.
- A função valida o cabeçalho secreto enviado pelo Telegram.
- A camada de linguagem não deve ser fonte de verdade para saldos ou totais.

## Banco

A migration inicial está em supabase/migrations/20261011182819_iris_initial_schema.sql. As tabelas financeiras têm RLS habilitado e não recebem políticas de acesso público; o webhook usa acesso privilegiado exclusivamente no servidor.

## Custo

Meta inicial: R$ 0. O valor consultado para a criação do projeto foi US$ 0/mês. Limites dos planos gratuitos e de fornecedores externos podem mudar; não há autorização para upgrades pagos.
