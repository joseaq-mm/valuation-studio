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
