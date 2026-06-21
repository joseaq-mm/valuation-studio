import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { searchTickers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// Prominent home search — primary call-to-action to start using the app.
export const HomeSearch = () => {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const timer = useRef(null);
    const boxRef = useRef(null);

    useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            try { const r = await searchTickers(query); setResults(r.results || []); setOpen(true); }
            catch { setResults([]); }
        }, 250);
    }, [query]);

    useEffect(() => {
        const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, []);

    const go = (ticker) => { setQuery(""); setResults([]); setOpen(false); navigate(`/company/${ticker}`); };
    const submit = (e) => { e.preventDefault(); if (query.trim()) go(query.trim().toUpperCase()); };

    return (
        <div ref={boxRef} className="relative w-full sm:w-[420px]" data-testid="home-search">
            <form onSubmit={submit} className="flex items-stretch border-2 border-black bg-white shadow-[4px_4px_0_0_#052049] focus-within:shadow-[2px_2px_0_0_#052049] transition-shadow" data-testid="home-search-form">
                <Search size={20} className="ml-3 self-center text-[#052049]" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => results.length && setOpen(true)}
                    placeholder={t("nav.search_placeholder")}
                    className="flex-1 px-3 py-3 outline-none font-mono text-base bg-transparent min-w-0"
                    data-testid="home-search-input"
                />
                <button type="submit" className="bg-[#052049] text-white px-5 font-semibold uppercase tracking-[0.12em] text-sm hover:bg-black transition-colors" data-testid="home-search-submit">
                    {t("nav.search_button")}
                </button>
            </form>
            {open && results.length > 0 && (
                <div className="absolute left-0 right-0 top-full bg-white border-2 border-black border-t-0 max-h-80 overflow-auto z-50 text-left" data-testid="home-search-results">
                    {results.map((r, i) => (
                        <button
                            key={i}
                            onClick={() => go(r.symbol)}
                            className="w-full text-left px-3 py-2 hover:bg-[#F5E4D4] border-b border-black/10 flex justify-between items-center text-sm"
                            data-testid={`home-search-result-${r.symbol}`}
                        >
                            <div><span className="font-mono font-semibold">{r.symbol}</span><span className="ml-2 text-[#4A4A4A]">{r.name}</span></div>
                            <span className="overline text-[#4A4A4A]">{r.exchange}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
