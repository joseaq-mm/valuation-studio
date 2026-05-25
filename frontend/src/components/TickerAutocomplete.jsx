import React, { useEffect, useRef, useState } from "react";
import { searchTickers } from "@/lib/api";

/**
 * Reusable ticker autocomplete input. Calls /api/search?q=... with 200ms debounce.
 * Props:
 *   - value (string): current input value
 *   - onChange (string): called as the user types
 *   - onPick ({symbol, name, exchange}): called when a result is selected
 *   - placeholder, testid, disabled
 */
export default function TickerAutocomplete({ value, onChange, onPick, placeholder, testid, disabled }) {
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const tRef = useRef(null);
    const wrapRef = useRef(null);

    useEffect(() => {
        clearTimeout(tRef.current);
        if (!value || value.length < 1) { setResults([]); return; }
        tRef.current = setTimeout(() => {
            searchTickers(value).then(r => {
                setResults(r.results || []);
                setOpen(true);
                setHighlight(-1);
            }).catch(() => setResults([]));
        }, 200);
        return () => clearTimeout(tRef.current);
    }, [value]);

    useEffect(() => {
        const onClick = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, []);

    const pick = (r) => {
        onPick && onPick(r);
        onChange(r.symbol);
        setOpen(false);
        setResults([]);
    };

    const onKey = (e) => {
        if (!open || !results.length) return;
        if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
        else if (e.key === "Enter") {
            if (highlight >= 0) { e.preventDefault(); pick(results[highlight]); }
        } else if (e.key === "Escape") setOpen(false);
    };

    return (
        <div ref={wrapRef} className="relative">
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => results.length && setOpen(true)}
                onKeyDown={onKey}
                placeholder={placeholder}
                disabled={disabled}
                className="input-paper font-mono w-full uppercase"
                data-testid={testid}
                autoComplete="off"
            />
            {open && results.length > 0 && (
                <div className="absolute left-0 right-0 z-30 bg-white border border-black border-t-0 max-h-64 overflow-y-auto" data-testid={`${testid}-results`}>
                    {results.map((r, i) => (
                        <button
                            key={r.symbol}
                            type="button"
                            onClick={() => pick(r)}
                            onMouseEnter={() => setHighlight(i)}
                            className={`w-full text-left px-3 py-2 border-b border-black/10 last:border-b-0 ${i === highlight ? "bg-[#F5E4D4]" : "hover:bg-[#FAF6EE]"}`}
                            data-testid={`${testid}-option-${r.symbol}`}
                        >
                            <div className="font-mono text-sm">{r.symbol} <span className="text-[#4A4A4A] text-[10px]">{r.exchange || ""}</span></div>
                            <div className="text-xs text-[#4A4A4A]">{r.name}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
