# Especificação técnica: Íris

## Objetivo

Assistente de finanças pessoais no Telegram, em português brasileiro, com orçamento inicial zero e arquitetura hospedada no Supabase.

## Arquitetura

Telegram Bot API → Supabase Edge Function (telegram-webhook) → Supabase REST/PostgreSQL. A função é publicada com verify_jwt=false porque o Telegram não fornece JWT Supabase; a autenticação externa é feita pelo cabeçalho x-telegram-bot-api-secret-token e pelo segredo TELEGRAM_WEBHOOK_SECRET. O serviço deve falhar fechado se o segredo estiver ausente.

## Fonte de verdade

- Transações, contas, categorias, dívidas, metas, orçamentos e lembretes vivem em tabelas estruturadas.
- Cálculos financeiros são feitos por consultas SQL com filtros de usuário e intervalos temporais explícitos.
- Modelos de linguagem podem classificar intenções, mas nunca determinam saldos nem valores calculados.
- Idempotência de webhook e transações deve ser reforçada antes de abrir uso amplo; atualizações do Telegram precisam ser processadas de modo recuperável e sem duplicar lançamentos em retentativas.

## Memória

1. Memória financeira estruturada: tabelas SQL.
2. Memória conversacional recente: conversation_messages.
3. Resumos automáticos: memory_summaries.
4. Memória semântica: coluna embedding com pgvector, ainda sem pipeline de embeddings nem busca semântica implementados.

A memória não deve ser usada para responder valores financeiros em substituição às consultas SQL.

## Tabelas iniciais

- iris_users: identidade do usuário Telegram e preferências regionais.
- accounts: contas e saldos iniciais.
- categories: categorias de receita/despesa.
- transactions: lançamentos e transferências.
- budgets: orçamentos.
- goals: metas financeiras.
- debts e debt_payments: dívidas e pagamentos.
- recurring_rules: regras de recorrência.
- reminders: lembretes.
- telegram_updates: deduplicação e estado de processamento do webhook.
- conversation_messages: histórico de conversa.
- memory_summaries: resumos e embeddings.
- user_preferences: preferências estruturadas.

## Segurança

- RLS habilitado nas tabelas públicas; sem políticas de leitura/escrita para anon/authenticated. A aplicação inicial opera por Edge Function privilegiada.
- A service role nunca pode ser incluída no repositório nem em cliente.
- Validar que IDs de contas, categorias, dívidas e transações pertencem ao mesmo usuário antes de qualquer associação.
- Ações destrutivas e interpretações ambíguas devem pedir confirmação.
- Minimizar dados enviados a provedores externos; áudio bruto não deve ser retido por padrão.
- Erros de provedor externo devem cair para fluxo determinístico e não devem impedir consultas locais básicas.

## Estado de implementação

Concluído:
- Projeto Supabase Iris na região sa-east-1.
- Schema inicial e extensões pgcrypto/pgvector.
- Edge Function inicial telegram-webhook publicada.
- Repositório com README, migration, configuração, .gitignore e template de ambiente.

Ainda pendente:
- Configurar TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no Supabase.
- Registrar o webhook real no Telegram.
- Melhorar a idempotência para retentativas e garantir atomicidade do registro financeiro.
- Implementar contas/categorias padrão, transferências, consultas SQL e relatórios.
- Implementar resumo automático e embeddings com provedor gratuito opcional e fallback.
- Implementar voz/STT/TTS com fallback para texto.
- Implementar recorrências e lembretes com scheduler seguro.
- Testes unitários, integração e verificação de segurança.

## Política de custo

Não criar recursos pagos, ativar upgrades ou contratar fornecedores pagos sem aprovação explícita. Quotas gratuitas não são ilimitadas e podem mudar. Fallback local significa lógica determinística na Edge Function, não execução de um LLM local dentro do Supabase.
