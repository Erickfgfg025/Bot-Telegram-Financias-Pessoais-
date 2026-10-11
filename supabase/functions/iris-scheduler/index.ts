import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
async function db(path: string, init: RequestInit = {}) {
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("Server database configuration is missing");
  return await fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
async function telegram(method: string, payload: Record<string, unknown>) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram token is not configured");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Telegram API returned " + response.status);
  return await response.json();
}
function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function nextDate(value: string, frequency: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (frequency === "weekly") return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  if (frequency === "yearly") {
    const d = new Date(Date.UTC(year + 1, month - 1, day));
    if (d.getUTCMonth() !== month - 1) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  const targetMonth = month === 12 ? 1 : month + 1;
  const targetYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return targetYear + "-" + String(targetMonth).padStart(2, "0") + "-" + String(Math.min(day, lastDay)).padStart(2, "0");
}
async function getChat(userId: string): Promise<number | null> {
  const response = await db("iris_users?id=eq." + encodeURIComponent(userId) + "&select=telegram_chat_id&limit=1");
  if (!response.ok) throw new Error("Could not read Telegram chat");
  const rows = await response.json();
  return rows?.[0]?.telegram_chat_id ? Number(rows[0].telegram_chat_id) : null;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = env("IRIS_SCHEDULER_SECRET");
  if (!secret) return json({ error: "scheduler_secret_not_configured" }, 503);
  if (req.headers.get("x-iris-scheduler-secret") !== secret) return json({ error: "unauthorized" }, 401);
  try {
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const reminderResponse = await db("reminders?status=eq.pending&remind_at=lte." + encodeURIComponent(now.toISOString()) + "&select=id,user_id,title,body,remind_at&order=remind_at.asc&limit=50");
    if (!reminderResponse.ok) throw new Error("Could not read due reminders");
    const reminders = await reminderResponse.json();
    let remindersSent = 0, remindersFailed = 0;
    for (const reminder of reminders) {
      try {
        const chatId = await getChat(reminder.user_id);
        if (!chatId) throw new Error("No Telegram chat is linked");
        await telegram("sendMessage", { chat_id: chatId, text: "⏰ Lembrete da Íris\n\n" + reminder.title + (reminder.body ? "\n" + reminder.body : "") });
        const updated = await db("reminders?id=eq." + encodeURIComponent(reminder.id) + "&status=eq.pending", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent" }) });
        if (!updated.ok) throw new Error("Could not mark reminder sent");
        remindersSent++;
      } catch { remindersFailed++; }
    }
    const rulesResponse = await db("recurring_rules?active=eq.true&next_run_at=lte." + today + "&select=id,user_id,description,kind,amount,frequency,next_run_at,category_id&order=next_run_at.asc&limit=50");
    if (!rulesResponse.ok) throw new Error("Could not read due recurring rules");
    const rules = await rulesResponse.json();
    let recurringCreated = 0, recurringFailed = 0;
    for (const rule of rules) {
      try {
        const dueDate = rule.next_run_at;
        const key = "recurring:" + rule.id + ":" + dueDate;
        const inserted = await db("transactions?on_conflict=user_id,idempotency_key", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify({
            user_id: rule.user_id, kind: rule.kind, amount: rule.amount, currency: "BRL",
            description: rule.description, category_id: rule.category_id, occurred_at: dueDate + "T12:00:00-03:00",
            recurring_key: rule.id, idempotency_key: key, source: "recurring",
            metadata: { recurring_rule_id: rule.id, scheduled_for: dueDate },
          }),
        });
        if (!inserted.ok) throw new Error("Could not create recurring transaction");
        const next = nextDate(dueDate, rule.frequency);
        const moved = await db("recurring_rules?id=eq." + encodeURIComponent(rule.id) + "&user_id=eq." + encodeURIComponent(rule.user_id) + "&next_run_at=eq." + dueDate, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ next_run_at: next }),
        });
        if (!moved.ok) throw new Error("Could not advance recurring rule");
        const chatId = await getChat(rule.user_id);
        if (chatId) await telegram("sendMessage", { chat_id: chatId, text: "🔁 Lançamento recorrente registrado\n" + (rule.kind === "income" ? "Receita" : "Despesa") + ": " + money(Number(rule.amount)) + "\nDescrição: " + rule.description + "\nData: " + new Date(dueDate + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" }) });
        recurringCreated++;
      } catch { recurringFailed++; }
    }
    return json({ ok: true, date: today, reminders_sent: remindersSent, reminders_failed: remindersFailed, recurring_processed: recurringCreated, recurring_failed: recurringFailed });
  } catch {
    return json({ error: "scheduler_processing_failed" }, 500);
  }
});