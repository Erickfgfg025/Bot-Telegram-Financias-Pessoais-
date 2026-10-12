# Íris: respostas por voz com ElevenLabs

## O que foi implementado

A Íris continua respondendo por texto e pode enviar um áudio MP3 com a mesma resposta pelo Telegram. A geração usa o endpoint oficial de Text-to-Speech do ElevenLabs. O texto continua disponível se a geração de áudio falhar.

Por segurança e para limitar consumo, respostas com mais de 1.800 caracteres ficam somente em texto. Erros do ElevenLabs não devem impedir a entrega da resposta textual.

## Configuração obrigatória

No projeto Supabase `njyfrmvryigzgojyvgxt`, adicione estas Secrets para as Edge Functions:

- `ELEVENLABS_API_KEY`: chave de API da sua conta ElevenLabs.
- `ELEVENLABS_VOICE_ID`: ID da voz que você personalizou ou selecionou na Voice Library do ElevenLabs.

Use a área de Secrets/Environment Variables das Edge Functions no Dashboard do Supabase. Não cole a API key nas conversas, no código ou no GitHub.

Depois de salvar as Secrets, teste a função enviando `/voz teste` no Telegram.

## Customização opcional

Os valores abaixo são variáveis de ambiente opcionais:

| Secret/variável | Padrão | Faixa/uso |
| --- | --- | --- |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | Modelo TTS. |
| `ELEVENLABS_STABILITY` | Usa o ajuste salvo na voz | 0 a 1, controla estabilidade/variação quando configurado. |
| `ELEVENLABS_SIMILARITY_BOOST` | Usa o ajuste salvo na voz | 0 a 1, fidelidade à voz escolhida quando configurado. |
| `ELEVENLABS_STYLE` | Usa o ajuste salvo na voz | 0 a 1, intensidade do estilo quando configurado. |
| `ELEVENLABS_SPEED` | Usa o ajuste salvo na voz | 0.25 a 4.0 quando configurado. |
| `ELEVENLABS_SPEAKER_BOOST` | Usa o ajuste salvo na voz | Defina `true` ou `false` para sobrescrever. |

O ID da voz é o principal controle da identidade vocal. Por padrão, a integração respeita os ajustes de voz salvos no ElevenLabs. Defina as variáveis opcionais no Supabase somente para sobrescrever estabilidade, similaridade, estilo, velocidade ou speaker boost.

## Controles no Telegram

- `/voz`: mostra o status e as instruções de configuração.
- `/voz teste`: solicita uma amostra da voz configurada.
- `/voz on`: ativa respostas em áudio.
- `/voz off`: desativa áudio e mantém somente texto.

Também são reconhecidas frases naturais como “responda por voz”, “quero áudio”, “responda só por texto” e “não mande áudio”. A preferência é guardada por usuário em `user_preferences.preferences`, sem criar uma tabela nova. Se a preferência não foi alterada, a voz fica ativada por padrão quando as Secrets obrigatórias estiverem presentes.

## Custo e privacidade

Cada resposta falada consome a quota/plano da conta ElevenLabs. Use `/voz off` para evitar novas gerações. Não configure a chave em variáveis públicas nem a registre em logs. O bot envia para o ElevenLabs apenas o texto da resposta que será falada; a resposta financeira também permanece no histórico da aplicação, conforme o funcionamento existente da Íris.

## Verificação

Depois do deploy:

1. Confira `/voz`: o status deve mostrar o ElevenLabs conectado.
2. Envie `/voz teste`: a Íris deve enviar o texto de confirmação e um áudio MP3.
3. Registre uma despesa de teste: a resposta deve continuar aparecendo em texto e áudio.
4. Envie `/voz off`: as próximas respostas devem ficar somente em texto.
5. Envie `/voz on`: o áudio deve voltar.

A implementação no código não equivale a um teste de ponta a ponta. O teste real precisa de uma API key e um Voice ID válidos configurados nas Secrets.
