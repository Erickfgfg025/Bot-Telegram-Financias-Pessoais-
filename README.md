# Íris 💜 | Finanças pessoais no Telegram

A Íris é uma assistente de finanças pessoais para Telegram, com Supabase como banco e backend. O projeto começa priorizando serviços gratuitos e não ativa recursos pagos automaticamente.

## Funcionalidades planejadas

- Receitas, despesas e transferências.
- Contas, categorias, orçamentos, metas, dívidas e pagamentos.
- Lançamentos recorrentes, parcelamentos e lembretes.
- Relatórios calculados a partir do PostgreSQL, nunca estimados pelo modelo de IA.
- Conversa contextual, histórico recente, resumos e memória semântica com pgvector.
- Entrada por texto primeiro; voz e provedores de IA serão etapas posteriores com fallback.
- Isolamento por usuário e segredos somente no Supabase.

## Estado atual

- Projeto Supabase criado na região São Paulo.
- Esquema inicial aplicado; 14 tabelas verificadas com RLS habilitado.
- Edge Function telegram-webhook publicada.
- O webhook ainda exige TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET para processar mensagens.
- A primeira versão do webhook reconhece alguns padrões simples de receita/despesa e comandos de ajuda. Não é ainda um assistente financeiro completo.
- IA externa, embeddings ativos, voz, lembretes agendados e relatórios completos ainda não estão ativados.

## Configuração do webhook

1. No Supabase, abra o projeto Iris e configure os secrets TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET para Edge Functions.
2. Não coloque tokens ou a chave service role no GitHub ou nesta conversa.
3. URL da função: https://njyfrmvryigzgojyvgxt.supabase.co/functions/v1/telegram-webhook
4. Configure o webhook do Telegram para essa URL, enviando o mesmo valor de TELEGRAM_WEBHOOK_SECRET como parâmetro secret_token.
5. Teste /start e, em seguida, um lançamento pequeno como “Gastei 25,90 no almoço”.
6. Se houver erro, consulte os logs da Edge Function antes de repetir lançamentos para evitar duplicações.

A função usa verify_jwt=false porque o Telegram não envia um JWT Supabase. Ela valida o cabeçalho secreto x-telegram-bot-api-secret-token. Sem o secret configurado, responde 503 e não processa mensagens.

## Segurança

- Nunca commite tokens, chaves, arquivos .env ou dados financeiros reais.
- O acesso ao banco é feito no servidor; a chave service role não deve ser exposta em clientes.
- Todas as 14 tabelas iniciais têm RLS habilitado e não têm políticas de acesso público. O webhook usa acesso privilegiado somente no servidor.
- O parser atual é determinístico e limitado. Não confie nele para interpretar pedidos complexos.
- Totais e saldos futuros devem ser calculados no SQL/PostgreSQL, nunca inventados pelo modelo de linguagem.

## Banco

Migration: supabase/migrations/20261011182819_iris_initial_schema.sql

## Custo

Meta inicial: R$ 0. O valor consultado para a criação do projeto foi US$ 0/mês. Limites de planos gratuitos e de fornecedores externos podem mudar; não há autorização para upgrades pagos.
