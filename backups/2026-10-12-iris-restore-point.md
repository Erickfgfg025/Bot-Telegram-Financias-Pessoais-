# Íris — checkpoint de recuperação

Data do checkpoint: 2026-10-12

## GitHub
- Repositório: https://github.com/Erickfgfg025/Bot-Telegram-Financias-Pessoais-
- Branch de backup: `backup/iris-2026-10-12-natural-delete-checkpoint`
- Commit base: `a13206e2d96110582c34e5576b857f2ce76fa79b`
- Estado verificado: `main` e o commit base estavam idênticos no momento do checkpoint.
- Arquivo principal: `supabase/functions/telegram-webhook/index.ts`.
- A alteração de confirmações em linguagem natural está no código do GitHub. O registro abaixo NÃO afirma que essa alteração específica foi implantada.

## Supabase — referência do projeto
- Projeto: `Iris`
- Project ref: `njyfrmvryigzgojyvgxt`
- Região: `sa-east-1`
- Estado observado: `ACTIVE_HEALTHY`
- PostgreSQL: versão 17.11
- Funções ativas observadas:
  - `telegram-webhook`: versão 52; status ACTIVE; verify_jwt=false
  - `register-telegram-webhook`: versão 4; status ACTIVE; verify_jwt=false
  - `iris-scheduler`: versão 6; status ACTIVE; verify_jwt=false

## Migrações registradas
- `20261011194524` — `iris_initial_schema`
- `20261011210915` — `iris_scheduler_extensions`
- `20261011212856` — `secure_iris_scheduler_vault_auth`

## Inventário do schema público
Snapshot de estrutura e contagem estimada de linhas. Não contém dados financeiros individuais nem segredos.
### public.iris_users
- RLS: enabled; linhas observadas: 1. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `telegram_user_id` (bigint), `telegram_chat_id` (bigint), `display_name` (text), `timezone` (text; default 'America/Fortaleza'::text), `currency` (character; default 'BRL'::bpchar), `created_at` (timestamp with time zone; default now()), `updated_at` (timestamp with time zone; default now())
- Chaves estrangeiras: categories_user_id_fkey: public.categories(user_id) → public.iris_users(id); transactions_user_id_fkey: public.transactions(user_id) → public.iris_users(id); budgets_user_id_fkey: public.budgets(user_id) → public.iris_users(id); accounts_user_id_fkey: public.accounts(user_id) → public.iris_users(id); goals_user_id_fkey: public.goals(user_id) → public.iris_users(id); debts_user_id_fkey: public.debts(user_id) → public.iris_users(id); debt_payments_user_id_fkey: public.debt_payments(user_id) → public.iris_users(id); recurring_rules_user_id_fkey: public.recurring_rules(user_id) → public.iris_users(id); reminders_user_id_fkey: public.reminders(user_id) → public.iris_users(id); conversation_messages_user_id_fkey: public.conversation_messages(user_id) → public.iris_users(id); memory_summaries_user_id_fkey: public.memory_summaries(user_id) → public.iris_users(id); user_preferences_user_id_fkey: public.user_preferences(user_id) → public.iris_users(id)
### public.accounts
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `name` (text), `account_type` (text; default 'checking'::text; check account_type = ANY (ARRAY['cash'::text, 'checking'::text, 'savings'::text, 'credit_card'::text, 'investment'::text, 'other'::text])), `opening_balance` (numeric; default 0), `currency` (character; default 'BRL'::bpchar), `is_archived` (boolean; default false), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: accounts_user_id_fkey: public.accounts(user_id) → public.iris_users(id); transactions_account_id_fkey: public.transactions(account_id) → public.accounts(id); transactions_transfer_account_id_fkey: public.transactions(transfer_account_id) → public.accounts(id); debt_payments_account_id_fkey: public.debt_payments(account_id) → public.accounts(id); recurring_rules_account_id_fkey: public.recurring_rules(account_id) → public.accounts(id)
### public.categories
- RLS: enabled; linhas observadas: 5. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `name` (text), `kind` (text; check kind = ANY (ARRAY['income'::text, 'expense'::text, 'both'::text])), `icon` (text), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: categories_user_id_fkey: public.categories(user_id) → public.iris_users(id); transactions_category_id_fkey: public.transactions(category_id) → public.categories(id); budgets_category_id_fkey: public.budgets(category_id) → public.categories(id); recurring_rules_category_id_fkey: public.recurring_rules(category_id) → public.categories(id)
### public.transactions
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `account_id` (uuid), `category_id` (uuid), `kind` (text; check kind = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text])), `amount` (numeric; check amount > 0::numeric), `currency` (character; default 'BRL'::bpchar), `description` (text), `occurred_at` (timestamp with time zone; default now()), `payment_method` (text), `transfer_account_id` (uuid), `installment_number` (integer), `installment_total` (integer), `recurring_key` (uuid), `source` (text; default 'telegram'::text), `idempotency_key` (text), `metadata` (jsonb; default '{}'::jsonb), `created_at` (timestamp with time zone; default now()), `updated_at` (timestamp with time zone; default now())
- Chaves estrangeiras: transactions_transfer_account_id_fkey: public.transactions(transfer_account_id) → public.accounts(id); transactions_user_id_fkey: public.transactions(user_id) → public.iris_users(id); transactions_account_id_fkey: public.transactions(account_id) → public.accounts(id); transactions_category_id_fkey: public.transactions(category_id) → public.categories(id); debt_payments_transaction_id_fkey: public.debt_payments(transaction_id) → public.transactions(id)
### public.budgets
- RLS: enabled; linhas observadas: 2. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `category_id` (uuid), `name` (text), `amount` (numeric; check amount >= 0::numeric), `period` (text; default 'monthly'::text; check period = ANY (ARRAY['weekly'::text, 'monthly'::text, 'yearly'::text])), `starts_on` (date; default CURRENT_DATE), `ends_on` (date), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: budgets_category_id_fkey: public.budgets(category_id) → public.categories(id); budgets_user_id_fkey: public.budgets(user_id) → public.iris_users(id)
### public.goals
- RLS: enabled; linhas observadas: 2. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `name` (text), `target_amount` (numeric; check target_amount > 0::numeric), `current_amount` (numeric; default 0; check current_amount >= 0::numeric), `target_date` (date), `status` (text; default 'active'::text; check status = ANY (ARRAY['active'::text, 'completed'::text, 'paused'::text, 'cancelled'::text])), `created_at` (timestamp with time zone; default now()), `updated_at` (timestamp with time zone; default now())
- Chaves estrangeiras: goals_user_id_fkey: public.goals(user_id) → public.iris_users(id)
### public.debts
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `name` (text), `creditor` (text), `original_amount` (numeric; check original_amount >= 0::numeric), `current_balance` (numeric; check current_balance >= 0::numeric), `due_date` (date), `status` (text; default 'active'::text; check status = ANY (ARRAY['active'::text, 'paid'::text, 'renegotiated'::text])), `notes` (text), `created_at` (timestamp with time zone; default now()), `updated_at` (timestamp with time zone; default now())
- Chaves estrangeiras: debt_payments_debt_id_fkey: public.debt_payments(debt_id) → public.debts(id); debts_user_id_fkey: public.debts(user_id) → public.iris_users(id)
### public.debt_payments
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `debt_id` (uuid), `amount` (numeric; check amount > 0::numeric), `paid_at` (timestamp with time zone; default now()), `account_id` (uuid), `transaction_id` (uuid), `notes` (text), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: debt_payments_user_id_fkey: public.debt_payments(user_id) → public.iris_users(id); debt_payments_debt_id_fkey: public.debt_payments(debt_id) → public.debts(id); debt_payments_account_id_fkey: public.debt_payments(account_id) → public.accounts(id); debt_payments_transaction_id_fkey: public.debt_payments(transaction_id) → public.transactions(id)
### public.recurring_rules
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `description` (text), `kind` (text; check kind = ANY (ARRAY['income'::text, 'expense'::text])), `amount` (numeric; check amount > 0::numeric), `frequency` (text; check frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'yearly'::text])), `next_run_at` (date), `account_id` (uuid), `category_id` (uuid), `active` (boolean; default true), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: recurring_rules_category_id_fkey: public.recurring_rules(category_id) → public.categories(id); recurring_rules_user_id_fkey: public.recurring_rules(user_id) → public.iris_users(id); recurring_rules_account_id_fkey: public.recurring_rules(account_id) → public.accounts(id)
### public.reminders
- RLS: enabled; linhas observadas: 2. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `title` (text), `body` (text), `remind_at` (timestamp with time zone), `status` (text; default 'pending'::text; check status = ANY (ARRAY['pending'::text, 'sent'::text, 'cancelled'::text])), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: reminders_user_id_fkey: public.reminders(user_id) → public.iris_users(id)
### public.telegram_updates
- RLS: enabled; linhas observadas: 104. PK: update_id.
- Colunas: `update_id` (bigint), `received_at` (timestamp with time zone; default now()), `processed_at` (timestamp with time zone), `status` (text; default 'received'::text; check status = ANY (ARRAY['received'::text, 'processed'::text, 'failed'::text])), `error_message` (text)
- Chaves estrangeiras: conversation_messages_telegram_update_id_fkey: public.conversation_messages(telegram_update_id) → public.telegram_updates(update_id)
### public.conversation_messages
- RLS: enabled; linhas observadas: 204. PK: id.
- Colunas: `id` (bigint), `user_id` (uuid), `telegram_update_id` (bigint), `role` (text; check role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])), `content` (text), `created_at` (timestamp with time zone; default now()), `metadata` (jsonb; default '{}'::jsonb)
- Chaves estrangeiras: conversation_messages_user_id_fkey: public.conversation_messages(user_id) → public.iris_users(id); conversation_messages_telegram_update_id_fkey: public.conversation_messages(telegram_update_id) → public.telegram_updates(update_id)
### public.memory_summaries
- RLS: enabled; linhas observadas: 0. PK: id.
- Colunas: `id` (uuid; default gen_random_uuid()), `user_id` (uuid), `summary` (text), `period_start` (timestamp with time zone), `period_end` (timestamp with time zone), `embedding` (USER-DEFINED), `created_at` (timestamp with time zone; default now())
- Chaves estrangeiras: memory_summaries_user_id_fkey: public.memory_summaries(user_id) → public.iris_users(id)
### public.user_preferences
- RLS: enabled; linhas observadas: 1. PK: user_id.
- Colunas: `user_id` (uuid), `preferences` (jsonb; default '{}'::jsonb), `updated_at` (timestamp with time zone; default now())
- Chaves estrangeiras: user_preferences_user_id_fkey: public.user_preferences(user_id) → public.iris_users(id)

## Limites deste checkpoint
- Este branch preserva o código Git no commit indicado e inclui este inventário para recuperação.
- O conector disponível não oferece exportação integral/`pg_dump` do banco nem snapshot restaurável dos dados nesta operação.
- Portanto, isto é um checkpoint de código + inventário de schema, NÃO um backup completo dos dados do banco.
- Para um backup integral restaurável, gerar um dump PostgreSQL pelo Supabase CLI/`pg_dump` em ambiente autorizado ou usar os backups nativos do Supabase; armazenar o arquivo fora do repositório Git para não expor registros financeiros.
- Não incluir tokens, chaves de API, secrets do Telegram ou conteúdo de conversas/registros financeiros neste repositório.