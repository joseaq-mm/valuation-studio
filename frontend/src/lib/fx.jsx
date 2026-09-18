import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fxRates } from "./api";

const KEY = "vs.display_currency";

// Currencies the UI offers in the selector. The data source still uses each
// company's native currency; we convert only for display.
export const SUPPORTED_CURRENCIES = ["NATIVE", "EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "MXN", "BRL", "ARS", "CNY", "HKD"];

const FxContext = createContext({
    display: "NATIVE",
    rates: {},
    convert: (v) => v,
    setDisplay: () => {},
    ready: false,
});

export function FxProvider({ children }) {
    const [display, setDisplay] = useState(() => {
        try { return window.localStorage.getItem(KEY) || "NATIVE"; } catch { return "NATIVE"; }
    });
    const [rates, setRates] = useState({});
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fxRates()
            .then(r => { if (!cancelled) { setRates(r.rates || {}); setReady(true); } })
            .catch(() => { if (!cancelled) setReady(true); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        try { window.localStorage.setItem(KEY, display); } catch { /* ignore */ }
    }, [display]);

    // amount in `from` → display currency. Returns null if conversion impossible.
    const convert = useCallback((amount, from) => {
        if (amount == null || isNaN(amount)) return amount;
        if (!display || display === "NATIVE" || !from) return amount;
        const f = String(from).toUpperCase();
        if (f === display) return amount;
        const rf = rates[f];
        const rd = rates[display];
        if (!rf || !rd) return amount;
        // rates are USD-base: amount_in_usd = amount / rf; amount_in_target = amount_in_usd * rd
        return (amount / rf) * rd;
    }, [display, rates]);

    return (
        <FxContext.Provider value={{ display, rates, convert, setDisplay, ready }}>
            {children}
        </FxContext.Provider>
    );
}

export const useFx = () => useContext(FxContext);

// For any UI that RANKS or SUMS money across tickers that may be in different
// native currencies (e.g. a donut comparing market cap across companies) —
// unlike `convert()` above (used for a single displayed value, where silently
// falling back to the native amount is an acceptable degrade), a silent
// fallback here would corrupt the comparison itself: an unconverted KRW/JPY
// figure mixed in with USD ones reads as a wildly wrong ranking (e.g. a ~0.7
// KRW/USD-scale mismatch made a single foreign holding look like the biggest
// position by two orders of magnitude). So `toDonut` returns null — excluding
// that item — whenever the rate needed isn't available, instead of ever
// returning a value in the wrong currency.
export function useDonutFx() {
    const { display, rates } = useFx();
    const donutCur = display && display !== "NATIVE" ? display : "USD";
    const toDonut = useCallback((v, cur) => {
        if (v == null || isNaN(v)) return null;
        const from = String(cur || "USD").toUpperCase();
        const to = donutCur;
        if (from === to) return v;
        const usd = from === "USD" ? v : (rates[from] ? v / rates[from] : null);
        if (usd == null) return null;
        return to === "USD" ? usd : (rates[to] ? usd * rates[to] : null);
    }, [donutCur, rates]);
    return { donutCur, toDonut };
}
