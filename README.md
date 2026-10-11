# Íris 💜 | Finanças pessoais no Telegram

A Íris é uma assistente de finanças pessoais para Telegram, com Supabase como banco e backend. O projeto começa priorizando serviços gratuitos e não ativa recursos pagos automaticamente.

## Funcionalidades disponíveis

- Registrar receitas e despesas por texto.
- Categorizar lançamentos automaticamente por palavras-chave, com categorias por usuário.
- Consultar saldo, resumo mensal e últimos lançamentos.
- Editar lançamentos com /editar e /editar 1; a alteração expira em 10 minutos.
- Excluir com confirmação usando /excluir, seleção do item e /confirmar.
- Definir orçamento mensal por categoria com /orcamento alimentação 500.
- Consultar progresso do orçamento com /orcamentos, incluindo aviso ao atingir 80% e 100% do limite.\n- Receber alertas imediatos quando um novo gasto cruzar 80% ou 100% do orçamento da categoria.\n- Consultar /relatorio para receitas, despesas, resultado do mês, taxa de economia e até cinco maiores categorias de gastos.
- Listar categorias com /categorias.
- Histórico de mensagens e processamento idempotente de updates do Telegram.

## Próximas etapas

- Contas e transferências completas.
- Metas, dívidas, pagamentos, recorrências e lembretes.
- Relatórios mais detalhados e alertas proativos.
- Conversa contextual avançada, memória semântica e entrada por voz.
- Melhorias de interpretação de linguagem natural com fallback determinístico.

## Estado atual

- Projeto Supabase criado na região São Paulo.
- Esquema inicial aplicado; 14 tabelas verificadas com RLS habilitado.
- Edge Function telegram-webhook publicada.
- O webhook ainda exige TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET para processar mensagens.
- Webhook ativo na versão 13.
- O parser de lançamentos continua determinístico e baseado em padrões simples. Categorias automáticas também usam palavras-chave, então descrições ambíguas podem cair em “Outros gastos” ou “Outras receitas”.
- Os orçamentos são consultados sob demanda com /orcamentos. Alertas automáticos por mensagem, voz, IA externa, embeddings ativos e lembretes agendados ainda não estão ativados.

## Configuração do webhook

1. No Supabase, abra o projeto Iris e configure os secrets TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET para Edge Functions.
2. Não coloque tokens ou a chave service role no GitHub ou nesta conversa.
3. URL da função: https://njyfrmvryigzgojyvgxt.supabase.co/functions/v1/telegram-webhook
4. Configure o webhook do Telegram para essa URL, enviando o mesmo valor de TELEGRAM_WEBHOOK_SECRET como parâmetro secret_token.
5. Teste /start e registre um lançamento de teste como “Gastei 25,90 no almoço”.
6. Confira /categorias; defina um limite com /orcamento alimentação 500, consulte /orcamentos e gere /relatorio.
7. Para editar, use /editar, escolha com /editar 1 e envie o novo valor e descrição. Para excluir, use /excluir e confirme com /confirmar.
8. Se houver erro, consulte os logs da Edge Function antes de repetir lançamentos para evitar duplicações.

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
