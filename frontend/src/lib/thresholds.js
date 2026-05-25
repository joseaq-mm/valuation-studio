// User-configurable thresholds for the cheap / fair / expensive signal.
// Default boundaries match the historical behaviour (cheap >= 20%, fair >= 0%).
//
// Stored in localStorage under "vs.thresholds.v1". Each ratio gets its own
// {cheap, fair} pair; values are in % units.

const KEY = "vs.thresholds.v1";

export const DEFAULT_THRESHOLDS = {
    compra: { cheap: 20, fair: 0 },
    venta: { cheap: 20, fair: 0 },
};

export const loadThresholds = () => {
    if (typeof window === "undefined") return DEFAULT_THRESHOLDS;
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return DEFAULT_THRESHOLDS;
        const parsed = JSON.parse(raw);
        return {
            compra: { ...DEFAULT_THRESHOLDS.compra, ...(parsed.compra || {}) },
            venta: { ...DEFAULT_THRESHOLDS.venta, ...(parsed.venta || {}) },
        };
    } catch {
        return DEFAULT_THRESHOLDS;
    }
};

export const saveThresholds = (t) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, JSON.stringify(t));
    // Broadcast a custom event so any subscribed UI updates immediately
    window.dispatchEvent(new CustomEvent("vs:thresholds-changed", { detail: t }));
};

export const resetThresholds = () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("vs:thresholds-changed", { detail: DEFAULT_THRESHOLDS }));
};

// Resolves a ratio % to a colour + label using current user thresholds.
export const signalFor = (pct, kind = "compra") => {
    const t = loadThresholds()[kind] || DEFAULT_THRESHOLDS[kind];
    if (pct === null || pct === undefined || isNaN(pct)) {
        return { color: "#4A4A4A", label: "—" };
    }
    if (pct >= t.cheap) return { color: "#1D7044", label: "BARATA" };
    if (pct >= t.fair) return { color: "#D97706", label: "JUSTA" };
    return { color: "#B32A22", label: "CARA" };
};
