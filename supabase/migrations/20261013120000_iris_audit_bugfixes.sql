-- Íris audit: preserve monthly recurrence day and index hot paths.
-- Safe to re-run: additive column, guarded constraint, and IF NOT EXISTS indexes.

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS recurrence_day integer;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recurring_rules'::regclass
      AND conname = 'recurring_rules_recurrence_day_check'
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_recurrence_day_check
      CHECK (recurrence_day IS NULL OR recurrence_day BETWEEN 1 AND 31);
  END IF;
END
$migration$;

-- Preserve a best-effort month day for existing rules. New rules store the
-- intended day explicitly, so short months do not shift later occurrences.
UPDATE public.recurring_rules
SET recurrence_day = EXTRACT(DAY FROM next_run_at)::integer
WHERE frequency = 'monthly' AND recurrence_day IS NULL;

CREATE INDEX IF NOT EXISTS budgets_category_id_idx ON public.budgets(category_id);
CREATE INDEX IF NOT EXISTS budgets_user_id_idx ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS conversation_messages_telegram_update_id_idx ON public.conversation_messages(telegram_update_id);
CREATE INDEX IF NOT EXISTS debt_payments_account_id_idx ON public.debt_payments(account_id);
CREATE INDEX IF NOT EXISTS debt_payments_debt_id_idx ON public.debt_payments(debt_id);
CREATE INDEX IF NOT EXISTS debt_payments_transaction_id_idx ON public.debt_payments(transaction_id);
CREATE INDEX IF NOT EXISTS debt_payments_user_id_idx ON public.debt_payments(user_id);
CREATE INDEX IF NOT EXISTS debts_user_id_idx ON public.debts(user_id);
CREATE INDEX IF NOT EXISTS goals_user_id_idx ON public.goals(user_id);
CREATE INDEX IF NOT EXISTS recurring_rules_account_id_idx ON public.recurring_rules(account_id);
CREATE INDEX IF NOT EXISTS recurring_rules_category_id_idx ON public.recurring_rules(category_id);
CREATE INDEX IF NOT EXISTS recurring_rules_user_id_idx ON public.recurring_rules(user_id);
CREATE INDEX IF NOT EXISTS reminders_user_id_idx ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON public.reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS recurring_rules_due_idx ON public.recurring_rules(active, next_run_at);
CREATE INDEX IF NOT EXISTS transactions_account_id_idx ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS transactions_category_id_idx ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS transactions_transfer_account_id_idx ON public.transactions(transfer_account_id);
