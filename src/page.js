export const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>gxyFi</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0c1016; color: #e7e1d6; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  #login { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card { width: min(420px, 100%); background: #141922; border: 1px solid #2c261c; border-top: 2px solid #c6a15b; padding: 28px; }
  h1 { margin: 0 0 8px; font-family: Palatino, "Palatino Linotype", serif; font-weight: 500; letter-spacing: 2px; color: #e4c98a; }
  p.sub { color: #8c877c; line-height: 1.6; }
  label { display: block; margin: 14px 0 6px; color: #c6a15b; font-size: 12px; }
  input, select { width: 100%; background: #10151c; border: 1px solid #3a3428; padding: 10px 12px; }
  input:focus, select:focus { outline: 1px solid #c6a15b; }
  .primary, .ghost, .danger { border-radius: 2px; padding: 8px 14px; }
  .primary { background: #c6a15b; color: #1a140c; border: none; font-weight: 650; }
  .ghost { background: transparent; border: 1px solid #3a3428; }
  .danger { background: transparent; border: 1px solid #6a403a; color: #c4786a; }
  .error { color: #c4786a; min-height: 1.2em; }
  #app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
  aside { background: #090c11; border-right: 1px solid #2a2418; padding: 28px 0; }
  aside strong { display: block; padding: 0 22px; color: #e4c98a; font-family: Palatino, serif; font-size: 26px; font-weight: 500; }
  aside em { display: block; padding: 4px 22px 18px; color: #8c877c; font-style: normal; font-size: 12px; }
  nav button { display: block; width: 100%; text-align: left; background: transparent; border: none; border-left: 2px solid transparent; color: #a39e94; padding: 12px 20px; }
  nav button.on { color: #f4e7c6; background: #16130e; border-left-color: #c6a15b; }
  main { padding: 22px 28px 40px; }
  header.bar { display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-bottom: 8px; }
  header.bar span { margin-right: auto; color: #8c877c; font-size: 13px; }
  section.view { display: none; }
  section.view.on { display: block; }
  h2 { font-family: Palatino, serif; font-weight: 500; color: #f4e7c6; margin: 8px 0; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .metric { background: #141922; border: 1px solid #2c261c; border-top: 1px solid #c6a15b; padding: 16px; }
  .metric b { display: block; margin-top: 8px; font-size: 26px; font-weight: 500; color: #f4e7c6; }
  .metric span, .hint { color: #8c877c; font-size: 12px; }
  form.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; color: #c6a15b; font-weight: 500; font-size: 12px; padding: 8px; border-bottom: 1px solid #2c261c; }
  td { padding: 8px; border-bottom: 1px solid #1c221b; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 900px) {
    #app { grid-template-columns: 1fr; }
    .metrics, form.grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<div id="login">
  <form class="card" id="loginForm">
    <h1>gxyFi</h1>
    <p class="sub">家庭资产台账。不开放注册，只有已经配置的账号可以进入，最多三个。这本云端账和 Windows 客户端各自保存，不会自动同步。</p>
    <label>账号</label>
    <input name="username" autocomplete="username" required>
    <label>密码</label>
    <input name="password" type="password" autocomplete="current-password" required>
    <p class="error" id="loginError"></p>
    <button class="primary" type="submit">进入</button>
  </form>
</div>
<div id="app" hidden>
  <aside>
    <strong>gxyFi</strong>
    <em>云端台账</em>
    <nav>
      <button type="button" data-view="dash" class="on">01 总览</button>
      <button type="button" data-view="accounts">02 储蓄</button>
      <button type="button" data-view="invest">03 投资</button>
      <button type="button" data-view="property">04 不动产</button>
      <button type="button" data-view="expenses">05 支出</button>
      <button type="button" data-view="budget">06 预算</button>
    </nav>
  </aside>
  <main>
    <header class="bar">
      <span id="fxLine">汇率未设置</span>
      <button class="ghost" id="refreshBtn" type="button">刷新行情</button>
      <a class="ghost" id="exportLink" href="/api/export.xls">导出 Excel</a>
      <button class="ghost" id="logoutBtn" type="button">退出</button>
    </header>
    <p class="error" id="appError"></p>
    <section class="view on" id="dash"></section>
    <section class="view" id="accounts"></section>
    <section class="view" id="invest"></section>
    <section class="view" id="property"></section>
    <section class="view" id="expenses"></section>
    <section class="view" id="budget"></section>
  </main>
</div>
<script>
const loginView = document.getElementById("login");
const appView = document.getElementById("app");
let state = null;

function money(value) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fxRate(code) {
  const row = (state.fx || []).find((item) => item.code === code);
  return row && row.rate != null ? Number(row.rate) : null;
}
function toCny(amount, currency) {
  if (amount == null) return null;
  if (currency === "CNY") return Number(amount);
  const rate = fxRate(currency);
  return rate == null ? null : Number(amount) * rate;
}
function latestBalance(accountId) {
  return (state.balances || []).find((row) => row.account_id === accountId);
}
function quoteFor(holding) {
  return (state.quotes || []).find((row) => row.market === holding.market && row.symbol === holding.symbol && row.ok);
}
function priceOf(holding) {
  if (holding.manual_price != null) return { price: Number(holding.manual_price), source: "手工" };
  const quote = quoteFor(holding);
  return quote ? { price: Number(quote.price), source: quote.source } : { price: null, source: "" };
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function table(headers, records) {
  const node = document.createElement("table");
  const head = document.createElement("tr");
  headers.forEach((header) => head.appendChild(el("th", header)));
  node.appendChild(head);
  records.forEach((record) => {
    const row = document.createElement("tr");
    record.forEach((value) => {
      const cell = document.createElement("td");
      if (value instanceof Node) cell.appendChild(value);
      else cell.textContent = value == null || value === "" ? "—" : String(value);
      row.appendChild(cell);
    });
    node.appendChild(row);
  });
  return node;
}
function field(form, name, placeholder, type) {
  const input = document.createElement(type === "select" ? "select" : "input");
  input.name = name;
  if (type === "select") {
    placeholder.forEach((item) => {
      const option = el("option", item[0]);
      option.value = item[1];
      input.appendChild(option);
    });
  } else {
    input.placeholder = placeholder;
    if (type) input.type = type;
  }
  form.appendChild(input);
  return input;
}
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}
function showError(error) {
  document.getElementById("appError").textContent = error.message || String(error);
}
async function refreshState(next) {
  state = next;
  document.getElementById("appError").textContent = (next.quoteErrors || []).join("；");
  const usd = fxRate("USD");
  document.getElementById("fxLine").textContent = usd == null ? "美元汇率未设置" : "USD/CNY " + usd.toFixed(4);
  render();
}
async function save(entity, data, id) {
  const payload = await post("/api/mutate", { entity, op: id ? "update" : "create", id: id || undefined, data });
  await refreshState(payload);
}
function removeButton(entity, id) {
  const button = el("button", "删除");
  button.type = "button";
  button.className = "danger";
  button.addEventListener("click", () => {
    if (!window.confirm("删除这条记录？")) return;
    remove(entity, id).catch(showError);
  });
  return button;
}
async function remove(entity, id) {
  await refreshState(await post("/api/mutate", { entity, op: "delete", id }));
}

function render() {
  renderDash();
  renderAccounts();
  renderInvest();
  renderProperty();
  renderExpenses();
  renderBudget();
}
function renderDash() {
  const root = document.getElementById("dash");
  root.replaceChildren();
  root.appendChild(el("h2", "总览"));
  root.appendChild(el("p", "储蓄用最近一次手工余额。投资用手工现价，没有则用最近行情。不动产净值 = 现值 − 贷款余额。", "hint"));
  let savings = 0, invest = 0, property = 0, missing = false;
  state.accounts.forEach((account) => {
    const balance = latestBalance(account.id);
    if (!balance) return;
    const cny = toCny(balance.balance, account.currency);
    if (cny == null) missing = true; else savings += cny;
  });
  state.holdings.forEach((holding) => {
    const priced = priceOf(holding);
    if (priced.price == null) { missing = true; return; }
    const cny = toCny(priced.price * holding.quantity, holding.currency);
    if (cny == null) missing = true; else invest += cny;
  });
  state.properties.forEach((item) => {
    if (item.current_value == null) { missing = true; return; }
    property += Number(item.current_value) - Number(item.mortgage_balance || 0);
  });
  const month = new Date().toISOString().slice(0, 7);
  const monthSpend = state.expenses.filter((row) => row.occurred_on.startsWith(month)).reduce((sum, row) => sum + Number(row.amount), 0);
  const year = new Date().getFullYear();
  const planned = state.budgets.filter((row) => row.year === year).reduce((sum, row) => sum + Number(row.amount), 0);
  const cards = [["储蓄", savings], ["投资", invest], ["不动产净值", property], ["净资产", savings + invest + property], ["本月支出", monthSpend], ["本年预算", planned]];
  const grid = el("div", null, "metrics");
  cards.forEach((card) => {
    const box = el("div", null, "metric");
    box.appendChild(el("span", card[0]));
    box.appendChild(el("b", "¥" + money(card[1])));
    grid.appendChild(box);
  });
  root.appendChild(grid);
  if (missing) root.appendChild(el("p", "有资产缺少现值、价格或汇率，净资产没有把它们算进去。", "hint"));
}
function renderAccounts() {
  const root = document.getElementById("accounts");
  root.replaceChildren();
  root.appendChild(el("h2", "储蓄"));
  root.appendChild(el("p", "余额只来自手工录入。同一账户同一天再次保存会覆盖。", "hint"));
  const form = document.createElement("form");
  form.className = "grid";
  field(form, "name", "账户名称");
  field(form, "institution", "机构");
  field(form, "kind", [["活期", "活期"], ["现金", "现金"], ["定期", "定期"], ["货币基金", "货币基金"], ["公积金", "公积金"], ["其他", "其他"]], "select");
  field(form, "currency", [["CNY", "CNY"], ["USD", "USD"], ["HKD", "HKD"]], "select");
  const button = el("button", "新增账户");
  button.className = "primary";
  form.appendChild(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("account", Object.fromEntries(new FormData(form))); form.reset(); }
    catch (error) { showError(error); }
  });
  root.appendChild(form);
  const balanceForm = document.createElement("form");
  balanceForm.className = "grid";
  const accountSelect = field(balanceForm, "account_id", [], "select");
  state.accounts.forEach((account) => {
    const option = el("option", account.name);
    option.value = account.id;
    accountSelect.appendChild(option);
  });
  field(balanceForm, "as_of_date", "日期 YYYY-MM-DD");
  field(balanceForm, "balance", "余额");
  field(balanceForm, "note", "备注");
  const balanceButton = el("button", "录入余额");
  balanceButton.className = "primary";
  balanceForm.appendChild(balanceButton);
  balanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("balance", Object.fromEntries(new FormData(balanceForm))); }
    catch (error) { showError(error); }
  });
  root.appendChild(balanceForm);
  const rows = [];
  state.accounts.forEach((account) => {
    const balance = latestBalance(account.id);
    rows.push([account.name, account.institution || "—", account.currency, balance ? money(balance.balance) : "—", balance ? balance.as_of_date : "—", removeButton("account", account.id)]);
  });
  root.appendChild(table(["账户", "机构", "币种", "最近余额", "截止日期", ""], rows));
}
function renderInvest() {
  const root = document.getElementById("invest");
  root.replaceChildren();
  root.appendChild(el("h2", "投资"));
  root.appendChild(el("p", "黄金按克填写，Au(T+D) 的行情是人民币/克。刷新只查询已有持仓，最多 30 个代码。", "hint"));
  const fx = document.createElement("form");
  fx.className = "grid";
  field(fx, "code", [["美元", "USD"], ["港币", "HKD"]], "select");
  field(fx, "rate", "1 单位折合人民币");
  const fxButton = el("button", "保存手工汇率");
  fxButton.className = "ghost";
  fx.appendChild(fxButton);
  fx.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("fx", Object.fromEntries(new FormData(fx))); }
    catch (error) { showError(error); }
  });
  root.appendChild(fx);
  const form = document.createElement("form");
  form.className = "grid";
  field(form, "market", [["黄金", "GOLD"], ["A股", "A"], ["美股", "US"], ["其他", "OTHER"]], "select");
  field(form, "symbol", "Au(T+D) / 600519 / AAPL");
  field(form, "name", "名称，可留空");
  field(form, "quantity", "数量");
  field(form, "avg_cost", "成本价，可留空");
  field(form, "manual_price", "手工现价，可留空");
  const button = el("button", "新增持仓");
  button.className = "primary";
  form.appendChild(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("holding", Object.fromEntries(new FormData(form))); form.reset(); }
    catch (error) { showError(error); }
  });
  root.appendChild(form);
  const rows = state.holdings.map((holding) => {
    const priced = priceOf(holding);
    const cny = priced.price == null ? null : toCny(priced.price * holding.quantity, holding.currency);
    return [holding.name, holding.symbol, holding.market, String(holding.quantity), priced.price == null ? "—" : money(priced.price), cny == null ? "—" : money(cny), priced.source || "—", removeButton("holding", holding.id)];
  });
  root.appendChild(table(["名称", "代码", "市场", "数量", "现价", "市值¥", "来源", ""], rows));
}
function renderProperty() {
  const root = document.getElementById("property");
  root.replaceChildren();
  root.appendChild(el("h2", "不动产"));
  root.appendChild(el("p", "金额按人民币。贷款若已在账户里记成负数，这里请填 0。", "hint"));
  const form = document.createElement("form");
  form.className = "grid";
  field(form, "name", "名称");
  field(form, "kind", [["住宅", "住宅"], ["商铺", "商铺"], ["车位", "车位"], ["土地", "土地"], ["其他", "其他"]], "select");
  field(form, "city", "城市");
  field(form, "current_value", "现值");
  field(form, "mortgage_balance", "贷款余额");
  field(form, "monthly_rent", "月租金");
  const button = el("button", "新增不动产");
  button.className = "primary";
  form.appendChild(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("property", Object.fromEntries(new FormData(form))); form.reset(); }
    catch (error) { showError(error); }
  });
  root.appendChild(form);
  root.appendChild(table(["名称", "类型", "城市", "现值", "贷款", "净值", "月租金", ""], state.properties.map((item) => [
    item.name, item.kind, item.city || "—", money(item.current_value), money(item.mortgage_balance),
    item.current_value == null ? "—" : money(Number(item.current_value) - Number(item.mortgage_balance || 0)),
    money(item.monthly_rent),
    removeButton("property", item.id),
  ])));
}
function renderExpenses() {
  const root = document.getElementById("expenses");
  root.replaceChildren();
  root.appendChild(el("h2", "支出"));
  const form = document.createElement("form");
  form.className = "grid";
  field(form, "occurred_on", "日期 YYYY-MM-DD");
  const category = field(form, "category_id", [], "select");
  state.categories.forEach((item) => {
    const option = el("option", item.name);
    option.value = item.id;
    category.appendChild(option);
  });
  field(form, "amount", "金额");
  field(form, "payee", "对象");
  const button = el("button", "记一笔");
  button.className = "primary";
  form.appendChild(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("expense", Object.fromEntries(new FormData(form))); }
    catch (error) { showError(error); }
  });
  root.appendChild(form);
  root.appendChild(table(["日期", "类别", "金额", "对象", ""], state.expenses.map((row) => [row.occurred_on, row.category, money(row.amount), row.payee || "—", removeButton("expense", row.id)])));
}
function renderBudget() {
  const root = document.getElementById("budget");
  root.replaceChildren();
  root.appendChild(el("h2", "预算"));
  const form = document.createElement("form");
  form.className = "grid";
  const year = field(form, "year", "年份");
  year.value = String(new Date().getFullYear());
  const category = field(form, "category_id", [], "select");
  state.categories.forEach((item) => {
    const option = el("option", item.name);
    option.value = item.id;
    category.appendChild(option);
  });
  field(form, "amount", "年度预算");
  const button = el("button", "保存预算");
  button.className = "primary";
  form.appendChild(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await save("budget", Object.fromEntries(new FormData(form))); }
    catch (error) { showError(error); }
  });
  root.appendChild(form);
  const names = Object.fromEntries(state.categories.map((item) => [item.id, item.name]));
  const spent = {};
  state.expenses.forEach((row) => {
    const key = row.occurred_on.slice(0, 4) + ":" + row.category_id;
    spent[key] = (spent[key] || 0) + Number(row.amount);
  });
  root.appendChild(table(["年份", "类别", "预算", "已支出", "剩余"], state.budgets.map((row) => {
    const actual = spent[row.year + ":" + row.category_id] || 0;
    return [String(row.year), names[row.category_id] || "—", money(row.amount), money(actual), money(Number(row.amount) - actual)];
  })));
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("loginError");
  error.textContent = "";
  try {
    await post("/api/login", Object.fromEntries(new FormData(event.target)));
    await refreshState(await (await fetch("/api/state", { credentials: "same-origin" })).json());
    loginView.hidden = true;
    appView.hidden = false;
  } catch (err) {
    error.textContent = err.message;
  }
});
document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((item) => item.classList.remove("on"));
    document.querySelectorAll("section.view").forEach((item) => item.classList.remove("on"));
    button.classList.add("on");
    document.getElementById(button.dataset.view).classList.add("on");
  });
});
document.getElementById("refreshBtn").addEventListener("click", async () => {
  try { await refreshState(await post("/api/quotes/refresh", {})); }
  catch (error) { showError(error); }
});
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await post("/api/logout", {});
  state = null;
  appView.hidden = true;
  loginView.hidden = false;
});
fetch("/api/state", { credentials: "same-origin" }).then(async (response) => {
  if (!response.ok) return;
  await refreshState(await response.json());
  loginView.hidden = true;
  appView.hidden = false;
});
</script>
</body>
</html>`;
