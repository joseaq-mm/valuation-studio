// European locale formatting: thousands "." and decimals ","
const LOCALE = "es-ES";

const nf2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfPct = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfFull = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nfFull2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e12) return nf2.format(n / 1e12) + "T";
    if (abs >= 1e9) return nf2.format(n / 1e9) + "B";
    if (abs >= 1e6) return nf2.format(n / 1e6) + "M";
    if (abs >= 1e3) return nf2.format(n / 1e3) + "K";
    return nf2.format(n);
};

// Full precision number with thousand separators, 2 decimals
export const fmtFull = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    if (Number.isInteger(n) && Math.abs(n) >= 1000) return nfFull.format(n);
    return nfFull2.format(n);
};

// Percentages: 1 decimal
export const fmtPct = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return nfPct.format(n * 100) + "%";
};

export const fmtPctRaw = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return nfPct.format(n) + "%";
};

export const fmtPctSigned = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const v = nfPct.format(n);
    return (n > 0 ? "+" : "") + v + "%";
};

export const fmtPrice = (n, currency = "USD") => {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const sym = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" }[currency] || "";
    return sym + nf2.format(n);
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

// Parse a string in es-ES format ("1.234.567,89") or plain ("1234567.89") back to number
export const parseLocaleNumber = (str) => {
    if (str === null || str === undefined || str === "") return null;
    const s = String(str).trim();
    if (s === "" || s === "-" || s === "." || s === ",") return null;
    // Remove spaces; if contains comma, treat dots as thousands and comma as decimal.
    // Otherwise just remove thousands dots if multiple.
    let normalized;
    if (s.indexOf(",") !== -1) {
        normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
        // Could be either "1234567.89" or "1.234.567" (thousands only).
        const parts = s.split(".");
        if (parts.length > 2) {
            normalized = parts.join("");
        } else {
            normalized = s;
        }
    }
    const n = parseFloat(normalized);
    return isNaN(n) ? null : n;
};

// Display-only formatter for input fields (keeps the user's editing in mind)
export const fmtInputDisplay = (n) => {
    if (n === null || n === undefined || isNaN(n)) return "";
    // For very small numbers (<1) keep up to 4 decimals so 0.4786 is preserved
    if (Math.abs(n) < 1 && n !== 0) {
        return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(n);
    }
    // Integers stay as integers; decimals show 2
    if (Number.isInteger(n)) return nfFull.format(n);
    return nfFull2.format(n);
};

// Smart compact format for tooltips/labels: 3 significant figures + auto unit
// Input is in billions (chart unit). Switches to M for values < 1B.
export const fmtCompact = (vInBillions) => {
    if (vInBillions === null || vInBillions === undefined || isNaN(vInBillions)) return "—";
    let v = vInBillions;
    let unit = "B";
    if (Math.abs(v) < 1) {
        v = v * 1000;
        unit = "M";
    }
    if (Math.abs(v) < 1 && unit === "M") {
        v = v * 1000;
        unit = "K";
    }
    const abs = Math.abs(v);
    let decimals;
    if (abs >= 100) decimals = 0;
    else if (abs >= 10) decimals = 1;
    else decimals = 2;
    const nf = new Intl.NumberFormat("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return nf.format(v) + " " + unit;
};
