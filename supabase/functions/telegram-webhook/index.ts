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
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
async function telegram(method: string, payload: Record<string, unknown>) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
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
  const kind = /\b(recebi|ganhei|salário|salario|renda|vendi)\b/.test(lower) ? "income" :
    /\b(gastei|paguei|comprei|despesa|conta de)\b/.test(lower) ? "expense" : null;
  if (!kind) return null;
  const match = text.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[.,]\d{1,2})?/i);
  if (!match) return null;
  const amount = parseMoney(match[0].replace(/^R\$/i, ""));
  if (!amount) return null;
  const description = text.replace(match[0], " ")
    .replace(/\b(recebi|ganhei|salário|salario|renda|vendi|gastei|paguei|comprei|despesa|conta de)\b/ig, " ")
    .replace(/\s+/g, " ").trim().replace(/^[,;:\- ]+|[,;:\- ]+$/g, "") ||
    (kind === "income" ? "Receita" : "Despesa");
  return { kind, amount, description: description.slice(0, 180) };
}
function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
type TransactionRow = { kind: string; amount: number | string; description: string | null; occurred_at: string };
async function getTransactions(userId: string, options: { from?: string; to?: string; limit?: number } = {}): Promise<TransactionRow[]> {
  const params = new URLSearchParams({
    select: "kind,amount,description,occurred_at",
    user_id: `eq.${userId}`,
    order: "occurred_at.desc",
    limit: String(options.limit ?? 1000),
  });
  if (options.from) params.set("occurred_at", `gte.${options.from}`);
  if (options.to) params.append("occurred_at", `lt.${options.to}`);
  const response = await db(`transactions?${params.toString()}`);
  if (!response.ok) throw new Error("Could not read financial transactions");
  return await response.json();
}
function monthRange() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00-03:00`;
  return { start, end, label: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }) };
}
function totals(rows: TransactionRow[]) {
  let income = 0, expense = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    if (row.kind === "income") income += amount;
    else if (row.kind === "expense") expense += amount;
  }
  return { income, expense, balance: income - expense };
}

async function sendText(chatId: number, userId: string, text: string) {
  const savedUser = await db("conversation_messages", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, role: "user", content: text }),
  });
  if (!savedUser.ok) throw new Error("Could not save incoming message");
  const entry = parseEntry(text);
  let answer: string;
  if (/^\/saldo\b/i.test(text.trim())) {
    const rows = await getTransactions(userId);
    const t = totals(rows);
    answer = `💰 <b>Seu saldo registrado</b>\n\n🟢 Receitas: <b>${money(t.income)}</b>\n🔴 Despesas: <b>${money(t.expense)}</b>\n━━━━━━━━━━━━\n💵 Saldo: <b>${money(t.balance)}</b>\n\n<i>Considera até os últimos 1.000 lançamentos registrados.</i>`;
  } else if (/^\/resumo\b/i.test(text.trim())) {
    const range = monthRange();
    const rows = await getTransactions(userId, { from: range.start, to: range.end });
    const t = totals(rows);
    answer = `📊 <b>Resumo de ${escapeHtml(range.label)}</b>\n\n🟢 Receitas: <b>${money(t.income)}</b>\n🔴 Despesas: <b>${money(t.expense)}</b>\n━━━━━━━━━━━━\n💵 Resultado do mês: <b>${money(t.balance)}</b>\n🧾 Lançamentos: ${rows.length}`;
  } else if (/^\/ultimas\b/i.test(text.trim())) {
    const rows = await getTransactions(userId, { limit: 5 });
    if (!rows.length) {
      answer = "📭 <b>Nenhum lançamento encontrado.</b>\nRegistre algo, por exemplo: Gastei 25,90 no almoço.";
    } else {
      const lines = rows.map((row) => {
        const sign = row.kind === "income" ? "🟢 +" : "🔴 −";
        const date = new Date(row.occurred_at).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
        return `${sign} <b>${money(Number(row.amount) || 0)}</b> · ${escapeHtml(row.description || (row.kind === "income" ? "Receita" : "Despesa"))}\n   <i>${date}</i>`;
      });
      answer = `🧾 <b>Seus últimos lançamentos</b>\n\n${lines.join("\n\n")}`;
    }
  } else if (entry) {
    const insert = await db("transactions", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, kind: entry.kind, amount: entry.amount, currency: "BRL", description: entry.description, source: "telegram" }),
    });
    if (!insert.ok) throw new Error("Could not save financial transaction");
    const label = entry.kind === "income" ? "Receita" : "Despesa";
    answer = `✅ <b>${label} registrada</b>\nValor: <b>${entry.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b>\nDescrição: ${escapeHtml(entry.description)}\n\nVersão inicial: conta e categoria ainda não foram associadas.`;
  } else if (/^\/(start|ajuda|help)\b/i.test(text.trim())) {
    answer = "👋 <b>Olá! Eu sou a Íris.</b>\n\nPosso começar registrando receitas e despesas por texto. Exemplos:\n• Gastei 25,90 no almoço\n• Paguei 120 conta de luz\n• Recebi 200 de um freela\n\nRelatórios, voz, memória semântica e outros recursos ainda estão em implementação.";
  } else {
    answer = "Ainda não consegui identificar um lançamento com segurança.\n\nTente: <b>Gastei 25,90 no almoço</b> ou <b>Recebi 200 de um freela</b>. Consultas disponíveis: /saldo, /resumo e /ultimas.";
  }
  const savedAssistant = await db("conversation_messages", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, role: "assistant", content: answer.replace(/<[^>]*>/g, "") }),
  });
  if (!savedAssistant.ok) throw new Error("Could not save assistant response");
  await reply(chatId, answer);
}
Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json({ service: "iris-telegram-webhook", status: "ready" });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expectedSecret = env("TELEGRAM_WEBHOOK_SECRET");
  if (!expectedSecret) return json({ error: "webhook_secret_not_configured" }, 503);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) return json({ error: "unauthorized" }, 401);
  let update: Record<string, unknown>;
  try { update = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const updateId = Number(update.update_id);
  if (!Number.isSafeInteger(updateId)) return json({ ok: true, ignored: true });
  const message = update.message as Record<string, unknown> | undefined;
  const from = message?.from as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const telegramUserId = Number(from?.id);
  const chatId = Number(chat?.id);
  if (!text || !Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(chatId)) return json({ ok: true, ignored: true });
  try {
    const claimed = await db("telegram_updates", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ update_id: updateId, status: "received" }),
    });
    if (!claimed.ok) throw new Error("Could not claim Telegram update");
    const claimedRows = await claimed.json();
    if (!Array.isArray(claimedRows) || claimedRows.length === 0) return json({ ok: true, duplicate: true });
    const userResponse = await db("iris_users?on_conflict=telegram_user_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ telegram_user_id: telegramUserId, telegram_chat_id: chatId,
        display_name: [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 120) || null }),
    });
    if (!userResponse.ok) throw new Error("Could not register Telegram user");
    const users = await userResponse.json();
    const userId = users?.[0]?.id as string | undefined;
    if (!userId) throw new Error("Telegram user id was not returned");
    await sendText(chatId, userId, text);
    await db(`telegram_updates?update_id=eq.${updateId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processed", processed_at: new Date().toISOString() }),
    });
    return json({ ok: true });
  } catch (error) {
    try {
      await db(`telegram_updates?update_id=eq.${updateId}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed", error_message: String(error).slice(0, 500) }),
      });
    } catch { /* Return only a generic error to Telegram. */ }
    return json({ error: "processing_failed" }, 500);
  }
});