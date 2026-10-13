# Íris 💜 | Assistente pessoal no Telegram

A Íris é uma assistente de finanças pessoais para Telegram, com Supabase como banco e backend. O projeto prioriza um custo inicial de R$ 0 e não ativa recursos pagos automaticamente.

## Funcionalidades

- Registrar receitas e despesas com linguagem natural, por exemplo: "Recebi 1.000 reais de um freela", "Paguei 120 de conta de luz" e "Gastei 25,90 no almoço".
- Interpretar valores brasileiros como `1000`, `1.000`, `1.000,50` e `1000,50`.
- Categorizar lançamentos automaticamente por palavras-chave.
- Consultar saldo, resumo mensal, últimos lançamentos, categorias e relatório financeiro.
- Editar lançamentos por conversa, com expiração da operação após 10 minutos.
- Excluir lançamentos somente após confirmação explícita.
- Definir e acompanhar orçamentos por categoria, com alertas ao cruzar 80% e 100% do limite.
- Criar/listar/cancelar lembretes e criar/listar/pausar lançamentos recorrentes usando linguagem natural.
- Processar mensagens de texto e, com a API Gemini configurada, receber áudios do Telegram, transcrevê-los e responder por texto.
- Manter histórico de conversas e processar atualizações do Telegram com controle de duplicidade.

## Conversa por IA e áudio (opcional)

O webhook inclui integração opcional com o modelo `gemini-3.1-flash-lite` para interpretar pedidos não reconhecidos pelas regras existentes e responder sobre assuntos gerais. Também usa o modelo para transcrever áudios curtos enviados como mensagem de voz.

Para ativar:

1. Crie uma chave de API no [Google AI Studio](https://aistudio.google.com/app/apikey).
2. No painel do [projeto Íris no Supabase](https://supabase.com/dashboard/project/njyfrmvryigzgojyvgxt/settings/functions), abra os secrets das Edge Functions e adicione `GEMINI_API_KEY` com o valor da chave.
3. Não cole a chave no Telegram, nesta conversa ou no GitHub. Não a coloque no código.
4. Envie uma mensagem em texto que não seja um comando financeiro conhecido ou uma mensagem de voz curta para testar.

A integração é opcional: sem `GEMINI_API_KEY`, os fluxos determinísticos e as operações financeiras existentes continuam disponíveis, mas a IA geral e a transcrição de áudio não funcionam.

**Privacidade:** no nível gratuito da API Gemini, o conteúdo enviado pode ser usado pelo Google para melhorar seus produtos. Mensagens e áudios destinados à IA podem conter dados pessoais. Avise os usuários antes de habilitar essa função em um bot para clientes e não envie senhas, credenciais ou dados bancários completos. A API gratuita tem limites de uso que podem mudar. Consulte os [preços e condições atuais da API Gemini](https://ai.google.dev/gemini-api/docs/pricing).

A Íris pode transcrever mensagens de voz recebidas via Gemini e, quando configurado, gerar respostas em áudio com ElevenLabs. O envio de áudio nas respostas é opcional e controlado pela preferência de voz; os comandos /start e /ajuda permanecem somente em texto para economizar créditos. Configure GEMINI_API_KEY para transcrição e ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID nas secrets do Supabase para respostas faladas.

### Sobre Ollama

Ollama pode executar modelos localmente e é uma alternativa para reduzir o envio de dados a provedores externos. Para um bot hospedado no Supabase continuar respondendo enquanto o computador está desligado, contudo, seria necessário hospedar o modelo em outro servidor sempre ativo. O uso local é gratuito, mas depende do hardware, da memória e da disponibilidade desse servidor. A opção de nuvem do Ollama possui créditos/limites e pode exigir pagamento quando eles acabam.

## Configuração do Telegram

1. Configure `TELEGRAM_BOT_TOKEN` e `TELEGRAM_WEBHOOK_SECRET` nos secrets das Edge Functions.
2. Configure o webhook do Telegram para:
   `https://njyfrmvryigzgojyvgxt.supabase.co/functions/v1/telegram-webhook`
3. Use o mesmo valor de `TELEGRAM_WEBHOOK_SECRET` como `secret_token` na configuração do webhook.
4. Envie uma mensagem como "Gastei 25,90 no almoço", pergunte "Quanto tenho de saldo?" e confira se a Íris responde.
5. Para voz e conversa ampla com IA, configure também `GEMINI_API_KEY`.

A função usa `verify_jwt=false` porque o Telegram não envia um JWT Supabase. O webhook valida o cabeçalho secreto `x-telegram-bot-api-secret-token`.

## Agendador de lembretes e recorrências

A função `iris-scheduler` executa a cada cinco minutos por meio de `pg_cron` e `pg_net`. O segredo de autenticação é mantido no Supabase Vault sob o nome `iris_scheduler_secret`; a função valida o cabeçalho `x-iris-scheduler-secret` via RPC. O valor secreto não deve ser incluído no repositório.

O agendador envia lembretes vencidos e cria lançamentos recorrentes com chave de idempotência para evitar duplicação. Os logs do cron e das Edge Functions devem ser verificados ao diagnosticar falhas.

## Segurança e limites

- Nunca commite tokens, chaves, arquivos `.env` ou dados financeiros reais.
- A chave `service_role` permanece exclusivamente no servidor.
- As tabelas do projeto têm RLS habilitado; as operações privilegiadas são executadas no backend.
- O modelo de linguagem pode ajudar a interpretar intenção, mas não deve inventar saldos ou confirmar ações que não foram executadas.
- A IA só pode escolher entre operações permitidas. Consultas financeiras são executadas pelas funções existentes, e exclusões mantêm a confirmação.
- Sem IA externa, a interpretação continua baseada em regras e pode não entender todas as frases.
- O objetivo é manter o custo inicial em R$ 0. Os limites gratuitos de provedores podem mudar; não há autorização para upgrades pagos.

## Repositório e implantação

- Webhook: `supabase/functions/telegram-webhook/index.ts`
- Agendador: `supabase/functions/iris-scheduler/index.ts`
- Projeto Supabase: [Íris](https://supabase.com/dashboard/project/njyfrmvryigzgojyvgxt)

Após qualquer mudança, sincronize o código com o GitHub e valide o comportamento no Telegram. Não registre segredos em commits ou documentação.
