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

async function validateSchedulerSecret(candidate: string): Promise<boolean> {
  const response = await db("rpc/iris_validate_scheduler_secret", {
    method: "POST",
    body: JSON.stringify({ candidate }),
  });
  if (!response.ok) throw new Error("Could not validate scheduler authentication");
  return (await response.json()) === true;
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram token is not configured");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data?.ok !== true) throw new Error("Telegram API send failed (HTTP " + response.status + ")");
  return data;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function previousCompletedWeek(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Fortaleza", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const day = Number(parts.find(p => p.type === "day")?.value);
  const today = new Date(Date.UTC(year, month - 1, day));
  const currentMonday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
  const previousMonday = new Date(currentMonday.getTime() - 7 * 86400000);
  const previousPreviousMonday = new Date(currentMonday.getTime() - 14 * 86400000);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  const sunday = new Date(currentMonday.getTime() - 86400000);
  return {
    start: iso(previousMonday) + "T00:00:00-03:00", end: iso(currentMonday) + "T00:00:00-03:00",
    previousStart: iso(previousPreviousMonday) + "T00:00:00-03:00", previousEnd: iso(previousMonday) + "T00:00:00-03:00",
    startDate: iso(previousMonday),
    label: previousMonday.toLocaleDateString("pt-BR", { timeZone:"UTC" }) + " a " + sunday.toLocaleDateString("pt-BR", { timeZone:"UTC" }),
  };
}
async function readPreferences(userId: string): Promise<Record<string, unknown>> {
  const response = await db("user_preferences?user_id=eq." + encodeURIComponent(userId) + "&select=preferences&limit=1");
  if (!response.ok) throw new Error("Could not read user preferences");
  const rows = await response.json();
  return rows?.[0]?.preferences && typeof rows[0].preferences === "object" ? rows[0].preferences : {};
}
async function writePreferences(userId: string, preferences: Record<string, unknown>) {
  const response = await db("user_preferences?on_conflict=user_id", {
    method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify({user_id:userId,preferences,updated_at:new Date().toISOString()}),
  });
  if (!response.ok) throw new Error("Could not save weekly report preference");
}
async function weeklyReportText(userId: string, range: ReturnType<typeof previousCompletedWeek>): Promise<string> {
  const query = "user_id=eq." + encodeURIComponent(userId) + "&select=kind,amount,category_id,occurred_at&order=occurred_at.desc&limit=1000&occurred_at=";
  const [currentResponse, previousResponse] = await Promise.all([
    db("transactions?" + query + "gte." + encodeURIComponent(range.start) + "&occurred_at=lt." + encodeURIComponent(range.end)),
    db("transactions?" + query + "gte." + encodeURIComponent(range.previousStart) + "&occurred_at=lt." + encodeURIComponent(range.previousEnd)),
  ]);
  if (!currentResponse.ok || !previousResponse.ok) throw new Error("Could not read transactions for weekly report");
  const rows = await currentResponse.json();
  const previousRows = await previousResponse.json();
  let income = 0, expense = 0, previousExpense = 0;
  const byCategory = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = Number(row.amount) || 0;
    if (row.kind === "income") income += amount;
    else if (row.kind === "expense") {
      expense += amount;
      if (row.category_id) byCategory.set(row.category_id, (byCategory.get(row.category_id) || 0) + amount);
    }
  }
  for (const row of Array.isArray(previousRows) ? previousRows : []) if (row.kind === "expense") previousExpense += Number(row.amount) || 0;
  let comparison = "Sem base suficiente para comparar com a semana anterior.";
  if (previousExpense > 0) {
    const change = Math.round((expense - previousExpense) / previousExpense * 100);
    comparison = change > 0 ? "Despesas " + change + "% maiores que na semana anterior." :
      change < 0 ? "Despesas " + Math.abs(change) + "% menores que na semana anterior." : "Despesas iguais às da semana anterior.";
  } else if (expense > 0) comparison = "Houve despesas nesta semana; a semana anterior não teve despesas registradas.";
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  let topText = "Nenhuma despesa categorizada registrada.";
  if (top.length) {
    const categoryResponse = await db("categories?user_id=eq." + encodeURIComponent(userId) + "&select=id,name,icon");
    if (!categoryResponse.ok) throw new Error("Could not read categories for weekly report");
    const categories = await categoryResponse.json();
    const names = new Map<string, {name:string;icon:string}>();
    for (const category of Array.isArray(categories) ? categories : []) names.set(category.id, {name:category.name || "Categoria",icon:category.icon || "📁"});
    topText = top.map(([id,amount]) => {
      const category = names.get(id);
      return (category?.icon || "📁") + " " + (category?.name || "Categoria") + ": " + money(amount);
    }).join("\n");
  }
  const balance = income - expense;
  const savings = income > 0 ? Math.round(balance / income * 100) : null;
  return "📊 Relatório semanal da Íris\n" + range.label + "\n\n🟢 Receitas: " + money(income) +
    "\n🔴 Despesas: " + money(expense) + "\n" + (balance >= 0 ? "💚" : "⚠️") + " Resultado: " + money(balance) +
    "\n📈 Taxa de economia: " + (savings === null ? "sem receitas registradas" : savings + "%") +
    "\n🧾 Lançamentos: " + (Array.isArray(rows) ? rows.length : 0) + "\n" + comparison +
    "\n\nMaiores categorias de despesa:\n" + topText + "\n\nCalculado apenas com os lançamentos registrados.";
}
async function sendWeeklyReportsIfDue(now: Date): Promise<{sent:number;failed:number;skipped:number}> {
  const timeParts = new Intl.DateTimeFormat("en-GB", {timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const hour = Number(timeParts.find(p => p.type === "hour")?.value);
  const minute = Number(timeParts.find(p => p.type === "minute")?.value);
  const weekday = new Intl.DateTimeFormat("en-US", {timeZone:"America/Fortaleza",weekday:"short"}).format(now);
  if (weekday !== "Mon" || hour !== 9 || minute > 14) return {sent:0,failed:0,skipped:0};
  const usersResponse = await db("iris_users?select=id,telegram_chat_id&order=created_at.asc&limit=1000");
  if (!usersResponse.ok) throw new Error("Could not read users for weekly reports");
  const users = await usersResponse.json();
  const range = previousCompletedWeek(now);
  let sent = 0, failed = 0, skipped = 0;
  for (const user of Array.isArray(users) ? users : []) {
    try {
      if (!user.id || !user.telegram_chat_id) { skipped++; continue; }
      const preferences = await readPreferences(user.id);
      if (preferences.weekly_reports_enabled === false || preferences.weekly_report_sent_for === range.startDate) { skipped++; continue; }
      const report = await weeklyReportText(user.id, range);
      await telegram("sendMessage", {chat_id:Number(user.telegram_chat_id),text:report});
      preferences.weekly_report_sent_for = range.startDate;
      await writePreferences(user.id, preferences);
      sent++;
    } catch (error) {
      console.error("Weekly report delivery failed", String(user?.id || "unknown"), error instanceof Error ? error.message : "unknown error");
      failed++;
    }
  }
  return {sent,failed,skipped};
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
  const candidate = req.headers.get("x-iris-scheduler-secret") ?? "";
  if (!candidate) return json({ error: "unauthorized" }, 401);
  try {
    const valid = await validateSchedulerSecret(candidate);
    if (!valid) return json({ error: "unauthorized" }, 401);

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
      } catch (error) { console.error("Reminder delivery failed", reminder.id, error instanceof Error ? error.message : "unknown error"); remindersFailed++; }
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
      } catch (error) { console.error("Recurring processing failed", rule.id, error instanceof Error ? error.message : "unknown error"); recurringFailed++; }
    }
    const weeklyReports = await sendWeeklyReportsIfDue(now);
    return json({ ok: true, date: today, reminders_sent: remindersSent, reminders_failed: remindersFailed, recurring_processed: recurringCreated, recurring_failed: recurringFailed, weekly_reports_sent: weeklyReports.sent, weekly_reports_failed: weeklyReports.failed, weekly_reports_skipped: weeklyReports.skipped });
  } catch {
    return json({ error: "scheduler_processing_failed" }, 500);
  }
});