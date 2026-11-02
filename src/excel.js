function xml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cell(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`;
}

function sheet(name, headers, rows) {
  const head = `<Row>${headers.map((item) => cell(item)).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${row.map((item) => cell(item)).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${xml(name)}"><Table>${head}${body}</Table></Worksheet>`;
}

export function workbook(state) {
  const fx = Object.fromEntries(state.fx.map((row) => [row.code, row]));
  const latest = new Map();
  for (const row of state.balances) {
    if (!latest.has(row.account_id)) latest.set(row.account_id, row);
  }
  const quotes = new Map(state.quotes.map((row) => [`${row.market}:${row.symbol}`, row]));
  const sheets = [
    sheet("账户", ["账户", "机构", "类型", "币种", "最近余额", "截止日期", "备注"], state.accounts.map((row) => {
      const balance = latest.get(row.id);
      return [row.name, row.institution, row.kind, row.currency, balance ? balance.balance : "", balance ? balance.as_of_date : "", row.note];
    })),
    sheet("余额快照", ["账户编号", "日期", "余额", "备注"], state.balances.map((row) => [row.account_id, row.as_of_date, row.balance, row.note])),
    sheet("投资持仓", ["名称", "代码", "市场", "数量", "币种", "成本价", "手工现价", "行情价", "行情来源", "账户", "备注"], state.holdings.map((row) => {
      const quote = quotes.get(`${row.market}:${row.symbol}`);
      return [row.name, row.symbol, row.market, row.quantity, row.currency, row.avg_cost, row.manual_price, quote && quote.ok ? quote.price : "", quote ? quote.source : "", row.account_label, row.note];
    })),
    sheet("基金定投", ["基金", "代码", "每期金额", "周期", "状态", "份额", "成本", "净值", "市值", "浮盈", "备注"], (state.dcaPlans || []).map((row) => [
      row.name, row.symbol, row.amount, row.cycle_label, row.status, row.shares, row.cost, row.nav, row.market_value, row.pnl, row.note,
    ])),
    sheet("定投记录", ["基金编号", "类型", "确认日期", "金额", "确认净值", "确认份额", "手续费", "备注"], (state.dcaRecords || []).map((row) => [
      row.plan_id, row.kind, row.trade_date, row.amount, row.nav, row.shares, row.fee, row.note,
    ])),
    sheet("不动产", ["名称", "类型", "城市", "地址", "面积", "购入日", "购入价", "现值", "估值日", "贷款余额", "月租金", "备注"], state.properties.map((row) => [
      row.name, row.kind, row.city, row.address, row.area_sqm, row.acquired_on, row.purchase_price, row.current_value, row.valued_on, row.mortgage_balance, row.monthly_rent, row.note,
    ])),
    sheet("支出", ["日期", "类别", "金额", "对象", "备注"], state.expenses.map((row) => [row.occurred_on, row.category, row.amount, row.payee, row.note])),
    sheet("预算", ["年份", "类别编号", "金额", "备注"], state.budgets.map((row) => [row.year, row.category_id, row.amount, row.note])),
    sheet("汇率", ["币种", "汇率", "来源", "时间"], state.fx.map((row) => [row.code, row.rate, row.source, row.quoted_at])),
    sheet("行情", ["市场", "代码", "名称", "价格", "昨收", "币种", "时间", "来源", "状态", "说明"], state.quotes.map((row) => [
      row.market, row.symbol, row.name, row.price, row.prev_close, row.currency, row.quoted_at, row.source, row.ok ? "成功" : "失败", row.message,
    ])),
  ];
  const note = fx.USD ? `USD ${fx.USD.rate}` : "未设置美元汇率";
  sheets.unshift(sheet("说明", ["项目", "内容"], [["导出", "gxyFi 网站台账"], ["汇率", note], ["声明", "行情只用于估值，有延迟，不构成投资建议。Windows 客户端和 iPhone 登录同一账号时与本表是同一本账。"]]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheets.join("\n")}
</Workbook>`;
}
