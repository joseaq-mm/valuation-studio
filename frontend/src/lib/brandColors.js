// Predominant corporate brand color per ticker, with a deterministic fallback
// palette for unknown tickers so the portfolio donut stays colorful & stable.
const BRAND = {
    NVDA: "#76B900", AAPL: "#8E8E93", MSFT: "#00A4EF", GOOGL: "#4285F4", GOOG: "#4285F4",
    AMZN: "#FF9900", META: "#0866FF", TSLA: "#E82127", NFLX: "#E50914", AMD: "#ED1C24",
    INTC: "#0071C5", SAP: "#008FD3", KO: "#F40009", PEP: "#004B93", DIS: "#113CCF",
    V: "#1A1F71", MA: "#EB001B", JPM: "#005EB8", NKE: "#111111", ADBE: "#ED2224",
    CRM: "#00A1E0", ORCL: "#F80000", PYPL: "#003087", UBER: "#000000", BABA: "#FF6A00",
    SHOP: "#95BF47", SPOT: "#1DB954", ASML: "#0A4EA2", TSM: "#D2232A", AVGO: "#CC092F",
    QCOM: "#3253DC", CSCO: "#1BA0D7", IBM: "#0530AD", TXN: "#CC0000", MU: "#009DDC",
    "SAN.MC": "#EC0000", "BBVA.MC": "#004481", "ITX.MC": "#000000", "IBE.MC": "#8CC63F",
    "TEF.MC": "#0066CC", "SAP.DE": "#008FD3", "SIE.DE": "#009999", "MC.PA": "#8A6D3B",
    BRK: "#004E9E", WMT: "#0071CE", COST: "#E31837", HD: "#F96302", MCD: "#FFC72C",
};

const FALLBACK = [
    "#052049", "#B32A22", "#1D7044", "#B8860B", "#5A189A", "#0F766E",
    "#9D174D", "#3F6212", "#7C2D12", "#1E3A8A", "#831843", "#065F46",
];

const hashIndex = (str, mod) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % mod;
};

export const brandColor = (ticker) => {
    if (!ticker) return FALLBACK[0];
    const t = String(ticker).toUpperCase();
    if (BRAND[t]) return BRAND[t];
    const base = t.split(".")[0];
    if (BRAND[base]) return BRAND[base];
    return FALLBACK[hashIndex(t, FALLBACK.length)];
};
