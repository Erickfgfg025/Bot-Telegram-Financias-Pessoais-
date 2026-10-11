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

function parseEditDetails(raw: string): { amount: number; description: string } | null {
  const match = raw.match(/(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?/i);
  if (!match) return null;
  const amount = parseMoney(match[0].replace(/^R\$/i, ""));
  if (!amount) return null;
  const description = raw.replace(match[0], " ").replace(/^[,;:\- ]+|[,;:\- ]+$/g, "").replace(/\s+/g, " ").trim();
  if (!description) return null;
  return { amount, description: description.slice(0, 180) };
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
type TransactionRow = { id: string; kind: string; amount: number | string; description: string | null; occurred_at: string; category_id?: string | null };
async function getTransactions(userId: string, options: { from?: string; to?: string; limit?: number } = {}): Promise<TransactionRow[]> {
  const params = new URLSearchParams({
    select: "id,kind,amount,description,occurred_at,category_id",
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

async function readPreferences(userId: string): Promise<Record<string, unknown>> {
  const response = await db(`user_preferences?user_id=eq.${userId}&select=preferences&limit=1`);
  if (!response.ok) throw new Error("Could not read user preferences");
  const rows = await response.json();
  return rows?.[0]?.preferences && typeof rows[0].preferences === "object" ? rows[0].preferences : {};
}
async function writePreferences(userId: string, preferences: Record<string, unknown>) {
  const response = await db("user_preferences?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, preferences, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("Could not save user preferences");
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
function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}
function categoryGuess(description: string, kind: "income" | "expense"): { name: string; icon: string } {
  const text = normalizeText(description);
  if (kind === "income") {
    if (/\b(salario|pagamento|folha)\b/.test(text)) return { name: "Salário", icon: "💵" };
    if (/\b(freela|freelance|bico|servico)\b/.test(text)) return { name: "Trabalho extra", icon: "🧰" };
    if (/\b(venda|vendi)\b/.test(text)) return { name: "Vendas", icon: "🛍️" };
    if (/\b(dividendo|rendimento|investimento|juros)\b/.test(text)) return { name: "Investimentos", icon: "📈" };
    return { name: "Outras receitas", icon: "🟢" };
  }
  if (/\b(almoco|jantar|cafe|restaurante|lanche|mercado|supermercado|padaria|ifood|comida|feira)\b/.test(text)) return { name: "Alimentação", icon: "🍽️" };
  if (/\b(aluguel|condominio|moradia|moveis|reparo|reforma)\b/.test(text)) return { name: "Moradia", icon: "🏠" };
  if (/\b(luz|energia|agua|internet|telefone|celular|gas|conta de)\b/.test(text)) return { name: "Contas", icon: "🧾" };
  if (/\b(uber|99|gasolina|combustivel|onibus|passagem|estacionamento|transporte)\b/.test(text)) return { name: "Transporte", icon: "🚗" };
  if (/\b(farmacia|remedio|consulta|medico|dentista|saude)\b/.test(text)) return { name: "Saúde", icon: "💊" };
  if (/\b(cinema|jogo|steam|netflix|spotify|show|bar|viagem|passeio|lazer)\b/.test(text)) return { name: "Lazer", icon: "🎮" };
  if (/\b(roupa|calcado|sapato|shopping|eletronico|compras)\b/.test(text)) return { name: "Compras", icon: "🛍️" };
  if (/\b(curso|livro|faculdade|escola|mensalidade|educacao)\b/.test(text)) return { name: "Educação", icon: "📚" };
  return { name: "Outros gastos", icon: "📦" };
}
function requestedCategory(raw: string): { name: string; icon: string } {
  const normalized = normalizeText(raw);
  const aliases: Record<string, { name: string; icon: string }> = {
    alimentacao: { name: "Alimentação", icon: "🍽️" }, comida: { name: "Alimentação", icon: "🍽️" }, mercado: { name: "Alimentação", icon: "🍽️" },
    moradia: { name: "Moradia", icon: "🏠" }, aluguel: { name: "Moradia", icon: "🏠" },
    contas: { name: "Contas", icon: "🧾" }, luz: { name: "Contas", icon: "🧾" }, transporte: { name: "Transporte", icon: "🚗" },
    saude: { name: "Saúde", icon: "💊" }, lazer: { name: "Lazer", icon: "🎮" }, compras: { name: "Compras", icon: "🛍️" },
    educacao: { name: "Educação", icon: "📚" }, outros: { name: "Outros gastos", icon: "📦" },
  };
  if (aliases[normalized]) return aliases[normalized];
  const clean = raw.trim().replace(/\s+/g, " ");
  return { name: clean.charAt(0).toLocaleUpperCase("pt-BR") + clean.slice(1), icon: "📦" };
}
async function getOrCreateCategory(userId: string, category: { name: string; icon: string }, kind: "income" | "expense"): Promise<string> {
  const params = new URLSearchParams({ select: "id", user_id: `eq.${userId}`, name: `eq.${category.name}`, kind: `eq.${kind}`, limit: "1" });
  const found = await db(`categories?${params.toString()}`);
  if (!found.ok) throw new Error("Could not find financial category");
  const rows = await found.json();
  if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
  const created = await db("categories?on_conflict=user_id,name,kind", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, name: category.name, kind, icon: category.icon }),
  });
  if (!created.ok) throw new Error("Could not create financial category");
  const createdRows = await created.json();
  if (Array.isArray(createdRows) && createdRows[0]?.id) return createdRows[0].id;
  const retry = await db(`categories?${params.toString()}`);
  if (!retry.ok) throw new Error("Could not retrieve financial category");
  const retryRows = await retry.json();
  if (!Array.isArray(retryRows) || !retryRows[0]?.id) throw new Error("Financial category id was not returned");
  return retryRows[0].id;
}
function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}
async function backfillCategories(userId: string, from: string, to: string) {
  const rows = await getTransactions(userId, { from, to, limit: 1000 });
  for (const row of rows) {
    if (row.category_id || (row.kind !== "income" && row.kind !== "expense")) continue;
    const category = categoryGuess(row.description || "", row.kind);
    const categoryId = await getOrCreateCategory(userId, category, row.kind);
    const response = await db(`transactions?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(userId)}&category_id=is.null`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ category_id: categoryId }),
    });
    if (!response.ok) throw new Error("Could not categorize existing transaction");
  }
}
async function listBudgets(userId: string) {
  const response = await db(`budgets?user_id=eq.${encodeURIComponent(userId)}&period=eq.monthly&select=id,name,amount,category_id,starts_on,ends_on&order=created_at.desc`);
  if (!response.ok) throw new Error("Could not read monthly budgets");
  const rows = await response.json();
  const today = localToday();
  return (Array.isArray(rows) ? rows : []).filter((b: any) => b.starts_on <= today && (!b.ends_on || b.ends_on >= today));
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
  const editPreferences = await readPreferences(userId);
  const pendingEdit = editPreferences.pending_transaction_edit as { id?: string; created_at?: string } | undefined;
  const pendingEditCreatedAt = pendingEdit?.created_at ? Date.parse(pendingEdit.created_at) : 0;
  const pendingEditValid = Boolean(pendingEdit?.id && pendingEditCreatedAt && Date.now() - pendingEditCreatedAt <= 10 * 60 * 1000);
  let answer: string;
  if (/^\/cancelar\b/i.test(text.trim())) {
    const preferences = await readPreferences(userId);
    delete preferences.pending_transaction_delete;
    delete preferences.pending_transaction_edit;
    await writePreferences(userId, preferences);
    answer = "✅ A operação foi cancelada. Nenhum lançamento foi alterado.";
  } else if (pendingEditValid && !text.trim().startsWith("/")) {
    const details = parseEditDetails(text);
    if (!details) {
      answer = "Não consegui identificar o novo valor e a descrição. Envie, por exemplo: <b>35,90 almoço e café</b>. Para desistir, use /cancelar.";
    } else {
      const updated = await db(`transactions?id=eq.${encodeURIComponent(pendingEdit!.id!)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ amount: details.amount, description: details.description }),
      });
      if (!updated.ok) throw new Error("Could not update financial transaction");
      const updatedRows = await updated.json();
      delete editPreferences.pending_transaction_edit;
      await writePreferences(userId, editPreferences);
      answer = Array.isArray(updatedRows) && updatedRows.length
        ? `✏️ <b>Lançamento atualizado</b>\nNovo valor: <b>${money(details.amount)}</b>\nDescrição: ${escapeHtml(details.description)}`
        : "Não encontrei esse lançamento. Nenhuma outra transação foi alterada.";
    }
  } else if (pendingEdit && !pendingEditValid && !text.trim().startsWith("/")) {
    delete editPreferences.pending_transaction_edit;
    await writePreferences(userId, editPreferences);
    answer = "⌛ A edição expirou. Envie /editar para começar novamente.";
  } else if (/^\/confirmar\b/i.test(text.trim())) {
    const preferences = await readPreferences(userId);
    const pending = preferences.pending_transaction_delete as { id?: string; created_at?: string } | undefined;
    const createdAt = pending?.created_at ? Date.parse(pending.created_at) : 0;
    if (!pending?.id || !createdAt || Date.now() - createdAt > 10 * 60 * 1000) {
      delete preferences.pending_transaction_delete;
      await writePreferences(userId, preferences);
      answer = "⌛ Não há exclusão pendente válida. Envie /excluir para começar novamente.";
    } else {
      const removed = await db(`transactions?id=eq.${encodeURIComponent(pending.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "DELETE", headers: { Prefer: "return=representation" },
      });
      if (!removed.ok) throw new Error("Could not delete transaction");
      const deletedRows = await removed.json();
      delete preferences.pending_transaction_delete;
      await writePreferences(userId, preferences);
      answer = Array.isArray(deletedRows) && deletedRows.length
        ? "🗑️ <b>Lançamento excluído.</b> O registro foi removido e os totais serão recalculados nas consultas."
        : "Não encontrei esse lançamento. Ele pode já ter sido removido; nenhum outro registro foi alterado.";
    }
  } else if (/^\/editar(?:\s+(\d+))?\s*$/i.test(text.trim())) {
    const match = text.trim().match(/^\/editar(?:\s+(\d+))?\s*$/i);
    const index = match?.[1] ? Number(match[1]) : 0;
    const rows = await getTransactions(userId, { limit: 5 });
    if (!rows.length) {
      answer = "📭 Não há lançamentos para editar.";
    } else if (!index) {
      answer = "✏️ <b>Qual lançamento deseja editar?</b>\n\n" +
        rows.map((row, i) => `${i + 1}. ${row.kind === "income" ? "🟢 Receita" : "🔴 Despesa"} · <b>${money(Number(row.amount) || 0)}</b>\n   ${escapeHtml(row.description || "Sem descrição")} · ${new Date(row.occurred_at).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}`).join("\n\n") +
        "\n\nEnvie <code>/editar 1</code> para escolher. Depois, envie o novo valor e a descrição, por exemplo <code>35,90 almoço e café</code>. A edição expira em 10 minutos. Use /cancelar para desistir.";
    } else if (index < 1 || index > rows.length) {
      answer = `Escolha um número entre 1 e ${rows.length}. Envie /editar para ver a lista novamente.`;
    } else {
      const chosen = rows[index - 1];
      const preferences = await readPreferences(userId);
      delete preferences.pending_transaction_delete;
      preferences.pending_transaction_edit = { id: chosen.id, created_at: new Date().toISOString() };
      await writePreferences(userId, preferences);
      answer = `✏️ <b>Editar lançamento</b>\n\nAtual: <b>${money(Number(chosen.amount) || 0)}</b> · ${escapeHtml(chosen.description || "Sem descrição")}\n\nEnvie o novo valor e a descrição, por exemplo <code>35,90 almoço e café</code>. Para manter o lançamento atual, envie /cancelar.`;
    }
  } else if (/^\/excluir(?:\s+(\d+))?\s*$/i.test(text.trim())) {
    const match = text.trim().match(/^\/excluir(?:\s+(\d+))?\s*$/i);
    const index = match?.[1] ? Number(match[1]) : 0;
    const rows = await getTransactions(userId, { limit: 5 });
    if (!rows.length) {
      answer = "📭 Não há lançamentos para excluir.";
    } else if (!index) {
      answer = "🗑️ <b>Qual lançamento deseja excluir?</b>\n\n" +
        rows.map((row, i) => `${i + 1}. ${row.kind === "income" ? "🟢 Receita" : "🔴 Despesa"} · <b>${money(Number(row.amount) || 0)}</b>\n   ${escapeHtml(row.description || "Sem descrição")} · ${new Date(row.occurred_at).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}`).join("\n\n") +
        "\n\nEnvie <code>/excluir 1</code> para selecionar o primeiro item. A exclusão só ocorre após <code>/confirmar</code>. Para desistir, envie <code>/cancelar</code>.";
    } else if (index < 1 || index > rows.length) {
      answer = `Escolha um número entre 1 e ${rows.length}. Envie /excluir para ver a lista novamente.`;
    } else {
      const chosen = rows[index - 1];
      const preferences = await readPreferences(userId);
      preferences.pending_transaction_delete = { id: chosen.id, created_at: new Date().toISOString() };
      await writePreferences(userId, preferences);
      answer = `⚠️ <b>Confirme a exclusão</b>\n\n${chosen.kind === "income" ? "Receita" : "Despesa"}: <b>${money(Number(chosen.amount) || 0)}</b>\nDescrição: ${escapeHtml(chosen.description || "Sem descrição")}\n\nEnvie <code>/confirmar</code> para excluir este lançamento ou <code>/cancelar</code> para manter.`;
    }
  } else if (/^\/orcamento(?:\s+.+)?$/i.test(text.trim())) {
    const raw = text.trim().replace(/^\/orcamento\s*/i, "").trim();
    const amountMatch = raw.match(/(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?\s*$/i);
    if (!raw || !amountMatch) {
      answer = "🎯 <b>Definir orçamento mensal</b>\nUse: <code>/orcamento alimentação 500</code>\nA categoria pode ser Alimentação, Moradia, Contas, Transporte, Saúde, Lazer, Compras ou outra que você queira criar.";
    } else {
      const amount = parseMoney(amountMatch[0].replace(/^R\$/i, "").trim());
      const rawCategory = raw.slice(0, amountMatch.index).trim();
      if (!amount || !rawCategory) {
        answer = "Não consegui entender. Exemplo: <code>/orcamento alimentação 500</code>.";
      } else {
        const category = requestedCategory(rawCategory);
        const categoryId = await getOrCreateCategory(userId, category, "expense");
        const active = await listBudgets(userId);
        const existing = active.find((b: any) => b.category_id === categoryId);
        const range = monthRange();
        const payload = { user_id: userId, category_id: categoryId, name: category.name, amount, period: "monthly", starts_on: range.start.slice(0, 10), ends_on: null };
        if (existing) {
          const updated = await db(`budgets?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ amount, name: category.name, starts_on: range.start.slice(0, 10), ends_on: null }),
          });
          if (!updated.ok) throw new Error("Could not update monthly budget");
        } else {
          const created = await db("budgets", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
          if (!created.ok) throw new Error("Could not create monthly budget");
        }
        answer = `✅ <b>Orçamento mensal definido</b>\nCategoria: ${escapeHtml(category.name)}\nLimite: <b>${money(amount)}</b>\n\nUse /orcamentos para acompanhar quanto já foi gasto.`;
      }
    }
  } else if (/^\/orcamentos\b/i.test(text.trim())) {
    const range = monthRange();
    await backfillCategories(userId, range.start, range.end);
    const [budgets, rows] = await Promise.all([
      listBudgets(userId),
      getTransactions(userId, { from: range.start, to: range.end, limit: 1000 }),
    ]);
    const expenses = new Map<string, number>();
    for (const row of rows) if (row.kind === "expense" && row.category_id) expenses.set(row.category_id, (expenses.get(row.category_id) || 0) + Number(row.amount || 0));
    if (!budgets.length) {
      answer = "🎯 <b>Você ainda não definiu orçamentos.</b>\n\nExemplo: <code>/orcamento alimentação 500</code>\nDepois, use /orcamentos para acompanhar o mês.";
    } else {
      const lines = budgets.map((b: any) => {
        const spent = expenses.get(b.category_id) || 0;
        const limit = Number(b.amount) || 0;
        const percent = limit > 0 ? Math.round(spent / limit * 100) : 0;
        const remaining = limit - spent;
        const status = percent >= 100 ? "🚨 Limite atingido" : percent >= 80 ? "⚠️ Perto do limite" : "✅ Dentro do limite";
        return `• <b>${escapeHtml(b.name)}</b>\n  Gasto: ${money(spent)} de ${money(limit)} (${percent}%)\n  ${remaining >= 0 ? "Restam " + money(remaining) : "Excedido em " + money(Math.abs(remaining))} · ${status}`;
      });
      answer = `🎯 <b>Orçamentos de ${escapeHtml(range.label)}</b>\n\n${lines.join("\n\n")}\n\n<i>Os gastos são calculados a partir dos lançamentos categorizados do mês.</i>`;
    }
  } else if (/^\/relatorio\b/i.test(text.trim())) {
    const range = monthRange();
    await backfillCategories(userId, range.start, range.end);
    const [rows, categoriesResponse] = await Promise.all([
      getTransactions(userId, { from: range.start, to: range.end, limit: 1000 }),
      db(`categories?user_id=eq.${encodeURIComponent(userId)}&select=id,name,kind,icon`),
    ]);
    if (!categoriesResponse.ok) throw new Error("Could not read categories for report");
    const categoryRows = await categoriesResponse.json();
    const categoryMap = new Map<string, { name: string; icon: string }>();
    for (const category of Array.isArray(categoryRows) ? categoryRows : []) categoryMap.set(category.id, { name: category.name, icon: category.icon || "📁" });
    let income = 0;
    let expenses = 0;
    let count = 0;
    const byCategory = new Map<string, number>();
    for (const row of rows) {
      const amount = Number(row.amount) || 0;
      if (row.kind === "income") income += amount;
      else if (row.kind === "expense") {
        expenses += amount;
        if (row.category_id) byCategory.set(row.category_id, (byCategory.get(row.category_id) || 0) + amount);
      }
      if (row.kind === "income" || row.kind === "expense") count++;
    }
    const result = income - expenses;
    const savings = income > 0 ? Math.round(result / income * 100) : null;
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topText = top.length
      ? top.map(([id, amount]) => {
          const category = categoryMap.get(id);
          return `• ${category?.icon || "📁"} <b>${escapeHtml(category?.name || "Categoria")}</b>: ${money(amount)}`;
        }).join("\n")
      : "Ainda não há despesas categorizadas neste mês.";
    answer = `📊 <b>Relatório financeiro · ${escapeHtml(range.label)}</b>\n\n🟢 Receitas: <b>${money(income)}</b>\n🔴 Despesas: <b>${money(expenses)}</b>\n${result >= 0 ? "💚" : "⚠️"} Resultado: <b>${money(result)}</b>\n${savings === null ? "📈 Taxa de economia: sem receitas registradas" : `📈 Taxa de economia: <b>${savings}%</b>`}\n🧾 Lançamentos: ${count}\n\n<b>Maiores categorias de despesa</b>\n${topText}\n\n<i>Relatório calculado a partir dos lançamentos registrados.</i>`;
  } else if (/^\/categorias\b/i.test(text.trim())) {
    const response = await db(`categories?user_id=eq.${encodeURIComponent(userId)}&select=name,kind,icon&order=kind,name`);
    if (!response.ok) throw new Error("Could not read categories");
    const rows = await response.json();
    answer = Array.isArray(rows) && rows.length
      ? "🏷️ <b>Suas categorias</b>\n\n" + rows.map((c: any) => `${c.icon || "📁"} ${escapeHtml(c.name)} · ${c.kind === "income" ? "Receita" : "Despesa"}`).join("\n")
      : "Ainda não há categorias. Elas serão criadas automaticamente quando você registrar receitas e despesas.";
  } else if (/^\/saldo\b/i.test(text.trim())) {
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
    const category = categoryGuess(entry.description, entry.kind);
    const categoryId = await getOrCreateCategory(userId, category, entry.kind);
    const insert = await db("transactions", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, kind: entry.kind, amount: entry.amount, currency: "BRL", description: entry.description, category_id: categoryId, source: "telegram" }),
    });
    if (!insert.ok) throw new Error("Could not save financial transaction");
    let budgetNotice = "";
    if (entry.kind === "expense") {
      const range = monthRange();
      const [budgets, monthRows] = await Promise.all([
        listBudgets(userId),
        getTransactions(userId, { from: range.start, to: range.end, limit: 1000 }),
      ]);
      const currentSpend = monthRows.filter(row => row.kind === "expense" && row.category_id === categoryId).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const previousSpend = Math.max(0, currentSpend - entry.amount);
      const budget = budgets.find((item: any) => item.category_id === categoryId);
      if (budget && Number(budget.amount) > 0) {
        const limit = Number(budget.amount);
        const beforePercent = previousSpend / limit * 100;
        const afterPercent = currentSpend / limit * 100;
        if (beforePercent < 100 && afterPercent >= 100) {
          budgetNotice = `\n\n🚨 <b>Orçamento excedido!</b> ${escapeHtml(budget.name)}: ${money(currentSpend)} de ${money(limit)}.`;
        } else if (beforePercent < 80 && afterPercent >= 80) {
          budgetNotice = `\n\n⚠️ <b>Atenção ao orçamento</b> ${escapeHtml(budget.name)}: você já usou ${Math.round(afterPercent)}% do limite (${money(currentSpend)} de ${money(limit)}).`;
        }
      }
    }
    const label = entry.kind === "income" ? "Receita" : "Despesa";
    answer = `✅ <b>${label} registrada</b>\nValor: <b>${entry.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b>\nDescrição: ${escapeHtml(entry.description)}\n\nCategoria automática: ${escapeHtml(category.name)} ${category.icon}.${budgetNotice}`;
  } else if (/^\/(start|ajuda|help)\b/i.test(text.trim())) {
    answer = "👋 <b>Olá! Eu sou a Íris.</b>\n\nPosso começar registrando receitas e despesas por texto. Exemplos:\n• Gastei 25,90 no almoço\n• Paguei 120 conta de luz\n• Recebi 200 de um freela\n\nComandos: /saldo, /resumo, /ultimas, /editar, /excluir, /orcamento, /orcamentos, /relatorio e /categorias.";
  } else {
    answer = "Ainda não consegui identificar um lançamento com segurança.\n\nTente: <b>Gastei 25,90 no almoço</b> ou <b>Recebi 200 de um freela</b>. Comandos: /saldo, /resumo, /ultimas, /orcamento, /orcamentos, /relatorio, /categorias, /editar e /excluir.";
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