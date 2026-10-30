const SH = ["60", "68", "69", "50", "51", "52", "56", "58", "11", "90"];
const SZ = ["00", "30", "12", "15", "16", "18", "20"];
const BJ = ["43", "83", "87", "92"];
const GOLD = {
  "AU(T+D)": "Au(T+D)",
  "MAU(T+D)": "mAu(T+D)",
  "AG(T+D)": "Ag(T+D)",
  "AU99.99": "Au99.99",
  "AU99.95": "Au99.95",
  "AU100G": "Au100g",
  "IAU99.99": "iAu99.99",
};

export function toSina(symbol) {
  const text = String(symbol || "").trim().toLowerCase().replace(/\s/g, "");
  if (/^(sh|sz|bj)\d{6}$/.test(text)) return text;
  if (!/^\d{6}$/.test(text)) throw new Error("A 股代码应为 6 位数字");
  if (SH.some((prefix) => text.startsWith(prefix))) return `sh${text}`;
  if (SZ.some((prefix) => text.startsWith(prefix))) return `sz${text}`;
  if (BJ.some((prefix) => text.startsWith(prefix)) || text.startsWith("4") || text.startsWith("8")) return `bj${text}`;
  throw new Error("无法识别的 A 股代码");
}

export function toYahoo(symbol) {
  const text = String(symbol || "").trim().toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z0-9^=-]{1,16}$/.test(text)) throw new Error("美股代码无效");
  return text;
}

export function canonicalGold(symbol) {
  const key = String(symbol || "").trim().toUpperCase().replace(/\s/g, "");
  if (!GOLD[key]) throw new Error("黄金代码请用 Au(T+D)、mAu(T+D)、Ag(T+D) 或 Au99.99");
  return GOLD[key];
}

export function canonicalSymbol(market, symbol) {
  if (market === "A") return toSina(symbol).slice(2);
  if (market === "US") return toYahoo(symbol);
  if (market === "GOLD") return canonicalGold(symbol);
  const text = String(symbol || "").trim();
  if (!text) throw new Error("请填写代码");
  return text;
}
