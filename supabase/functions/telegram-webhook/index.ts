import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = { "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";

async function db(path: string, init: RequestInit = {}) {
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("Supabase server environment is not configured");
  return await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
  return await response.json();
}

async function reply(chatId: number, text: string) {
  await telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

function parseMoney(raw: string): number | null {
  const normalized = raw.replace(/\s/g, "").replace(/\.(?=\d{3}(?:,|$))/g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 && value < 100_000_000 ? Math.round(value * 100) / 100 : null;
}

function parseEntry(text: string): { kind: "income" | "expense"; amount: number; description: string } | null {
  const lower = text.toLocaleLowerCase("pt-BR");
  const kind = /\b(recebi|ganhei|salário|salario|renda|vendi)\b/.test(lower)
    ? "income"
    : /\b(gastei|paguei|comprei|despesa|conta de)\b/.test(lower)
    ? "expense"
    : null;
  if (!kind) return null;
  const match = text.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[.,]\d{1,2})?/i);
  if (!match) return null;
  const amount = parseMoney(match[0].replace(/^R\$/i, ""));
  if (!amount) return null;
  const description = text
    .replace(match[0], " ")
    .replace(/\b(recebi|ganhei|salário|salario|renda|vendi|gastei|paguei|comprei|despesa|conta de)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:\- ]+|[,;:\- ]+$/g, "") || (kind === "income" ? "Receita" : "Despesa");
  return { kind, amount, description: description.slice(0, 180) };
}

async function sendText(chatId: number, userId: string, text: string) {
  const response = await db("conversation_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, role: "user", content: text }),
  });
  if (!response.ok) throw new Error("Could not save incoming message");

  const entry = parseEntry(text);
  let answer: string;
  if (entry) {
    const insert = await db("transactions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId,
        kind: entry.kind,
        amount: entry.amount,
        currency: "BRL",
        description: entry.description,
        source: "telegram",
      }),
    });
    if (!insert.ok) throw new Error("Could not save financial transaction");
    const label = entry.kind === "income" ? "Receita" : "Despesa";
    answer = `✅ <b>${label} registrada</b>\nValor: <b>${entry.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b>\nDescrição: ${escapeHtml(entry.description)}\n\nEsta é a versão inicial. Ainda não associei conta ou categoria.`;
  } else if (/^\/(start|ajuda|help)\b/i.test(text.trim())) {
    answer = "👋 <b>Olá! Eu sou a Íris.</b>\n\nPosso começar registrando receitas e despesas por texto. Exemplos:\n• Gastei 25,90 no almoço\n• Paguei 120 conta de luz\n• Recebi 200 de um freela\n\nUse /ajuda para ver estes exemplos. Relatórios, voz, memória semântica e outros recursos ainda estão em implementação.";
  } else {
    answer = "Entendi sua mensagem, mas ainda não consegui identificar um lançamento com segurança.\n\nTente, por exemplo: <b>Gastei 25,90 no almoço</b> ou <b>Recebi 200 de um freela</b>. Ainda não interpreto pedidos financeiros complexos automaticamente.";
  }

  const saveAssistant = await db("conversation_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, role: "assistant", content: answer.replace(/<[^>]*>/g, "") }),
  });
  if (!saveAssistant.ok) throw new Error("Could not save assistant response");
  await reply(chatId, answer);
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json({ service: "iris-telegram-webhook", status: "ready" });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expectedSecret = env("TELEGRAM_WEBHOOK_SECRET");
  if (!expectedSecret) return json({ error: "webhook_secret_not_configured" }, 503);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const updateId = Number(update.update_id);
  if (!Number.isSafeInteger(updateId)) return json({ ok: true, ignored: true });

  const message = update.message as Record<string, unknown> | undefined;
  const from = message?.from as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const telegramUserId = Number(from?.id);
  const chatId = Number(chat?.id);
  if (!text || !Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(chatId)) {
    return json({ ok: true, ignored: true });
  }

  try {
    const claimed = await db("telegram_updates", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ update_id: updateId, status: "received" }),
    });
    if (!claimed.ok) throw new Error("Could not claim Telegram update");
    const claimedRows = await claimed.json();
    if (!Array.isArray(claimedRows) || claimedRows.length === 0) return json({ ok: true, duplicate: true });

    const userResponse = await db("iris_users?on_conflict=telegram_user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        telegram_user_id: telegramUserId,
        telegram_chat_id: chatId,
        display_name: [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 120) || null,
      }),
    });
    if (!userResponse.ok) throw new Error("Could not register Telegram user");
    const users = await userResponse.json();
    const userId = users?.[0]?.id as string | undefined;
    if (!userId) throw new Error("Telegram user id was not returned");

    await sendText(chatId, userId, text);
    await db(`telegram_updates?update_id=eq.${updateId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processed", processed_at: new Date().toISOString() }),
    });
    return json({ ok: true });
  } catch (error) {
    try {
      await db(`telegram_updates?update_id=eq.${updateId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed", error_message: String(error).slice(0, 500) }),
      });
    } catch { /* Keep the webhook response generic. */ }
    return json({ error: "processing_failed" }, 500);
  }
});
