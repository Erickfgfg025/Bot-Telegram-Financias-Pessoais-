-- Íris initial schema. Applied to project njyfrmvryigzgojyvgxt on 2026-10-11.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.iris_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint,
  display_name text,
  timezone text not null default 'America/Fortaleza',
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  name text not null,
  account_type text not null default 'checking' check (account_type in ('cash','checking','savings','credit_card','investment','other')),
  opening_balance numeric(14,2) not null default 0,
  currency char(3) not null default 'BRL',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income','expense','both')),
  icon text,
  created_at timestamptz not null default now(),
  unique (user_id, name, kind)
);
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  kind text not null check (kind in ('income','expense','transfer')),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'BRL',
  description text not null,
  occurred_at timestamptz not null default now(),
  payment_method text,
  transfer_account_id uuid references public.accounts(id) on delete set null,
  installment_number integer,
  installment_total integer,
  recurring_key uuid,
  source text not null default 'telegram',
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((installment_number is null and installment_total is null) or (installment_number > 0 and installment_total >= installment_number)),
  unique (user_id, idempotency_key)
);
create index if not exists transactions_user_date_idx on public.transactions(user_id, occurred_at desc);
create index if not exists transactions_user_kind_date_idx on public.transactions(user_id, kind, occurred_at desc);
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  period text not null default 'monthly' check (period in ('weekly','monthly','yearly')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active','completed','paused','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  name text not null,
  creditor text,
  original_amount numeric(14,2) not null check (original_amount >= 0),
  current_balance numeric(14,2) not null check (current_balance >= 0),
  due_date date,
  status text not null default 'active' check (status in ('active','paid','renegotiated')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  account_id uuid references public.accounts(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  description text not null,
  kind text not null check (kind in ('income','expense')),
  amount numeric(14,2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  next_run_at date not null,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  title text not null,
  body text,
  remind_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','failed')),
  error_message text
);
create table if not exists public.conversation_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.iris_users(id) on delete cascade,
  telegram_update_id bigint references public.telegram_updates(update_id) on delete set null,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists conversation_messages_user_created_idx on public.conversation_messages(user_id, created_at desc);
create table if not exists public.memory_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.iris_users(id) on delete cascade,
  summary text not null,
  period_start timestamptz,
  period_end timestamptz,
  embedding extensions.vector,
  created_at timestamptz not null default now()
);
create index if not exists memory_summaries_user_created_idx on public.memory_summaries(user_id, created_at desc);
create table if not exists public.user_preferences (
  user_id uuid primary key references public.iris_users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.iris_users enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.debts enable row level security;
alter table public.debt_payments enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.reminders enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.memory_summaries enable row level security;
alter table public.user_preferences enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
