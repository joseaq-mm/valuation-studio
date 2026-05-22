export const fmtNum = (n, digits = 2) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(digits) + "T";
    if (abs >= 1e9) return (n / 1e9).toFixed(digits) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(digits) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(digits) + "K";
    return n.toFixed(digits);
};

export const fmtPct = (n, digits = 2) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return (n * 100).toFixed(digits) + "%";
};

export const fmtPctRaw = (n, digits = 2) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toFixed(digits) + "%";
};

export const fmtPrice = (n, currency = "USD") => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const sym = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" }[currency] || "";
    return sym + n.toFixed(2);
};

export const ratioColor = (pct) => {
    if (pct === null || pct === undefined || isNaN(pct)) return "#4A4A4A";
    if (pct >= 20) return "#1D7044";
    if (pct >= 0) return "#D97706";
    return "#B32A22";
};

export const signalLabel = (pct) => {
    if (pct === null || pct === undefined || isNaN(pct)) return "—";
    if (pct >= 20) return "BARATA";
    if (pct >= 0) return "JUSTA";
    return "CARA";
};
