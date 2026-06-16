import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { searchTickers } from "@/lib/api";
import { Search } from "lucide-react";
import ThresholdsDialog from "./ThresholdsDialog";
import ThemeToggle from "./ThemeToggle";
import AuthButton from "./AuthButton";
import CurrencySelector from "./CurrencySelector";
import LanguageToggle from "./LanguageToggle";
import { useI18n } from "@/lib/i18n";

export default function Layout({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const timer = useRef(null);
    const boxRef = useRef(null);

    useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            try {
                const r = await searchTickers(query);
                setResults(r.results || []);
                setShowResults(true);
            } catch { setResults([]); }
        }, 250);
    }, [query]);

    useEffect(() => {
        const handler = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setShowResults(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const go = (ticker) => {
        setQuery("");
        setResults([]);
        setShowResults(false);
        navigate(`/company/${ticker}`);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (query.trim()) go(query.trim().toUpperCase());
    };

    const navClass = (path) => `text-xs uppercase tracking-[0.15em] font-semibold px-3 py-1 ${
        location.pathname === path || location.pathname.startsWith(path + "/")
            ? "bg-black text-[#FDF1E6]"
            : "text-black hover:bg-black hover:text-[#FDF1E6]"
    } transition-colors`;

    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-base)" }}>
            <header className="border-b border-black sticky top-0 z-40" style={{ background: "var(--bg-base)" }}>
                <div className="max-w-[1400px] mx-auto px-6">
                    {/* Row 1: Logo · Search · Auth */}
                    <div className="py-3 flex items-center gap-6 border-b border-black/10">
                        <Link to="/" className="flex items-center gap-3 shrink-0" data-testid="nav-home">
                            <div className="w-8 h-8 border border-black flex items-center justify-center bg-white">
                                <div className="w-3 h-3 bg-[#052049]" />
                            </div>
                            <div className="leading-none">
                                <div className="font-serif text-2xl font-medium">Valuation Studio</div>
                                <div className="overline text-[#4A4A4A]">Equity Research</div>
                            </div>
                        </Link>

                        <div ref={boxRef} className="flex-1 relative">
                            <form onSubmit={handleSubmit} className="flex items-center border border-black bg-white" data-testid="search-form">
                                <Search size={16} className="ml-3 text-[#4A4A4A]" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t("nav.search_placeholder")}
                                    className="flex-1 px-3 py-2 outline-none font-mono text-sm bg-transparent"
                                    data-testid="search-input"
                                    onFocus={() => results.length && setShowResults(true)}
                                />
                                <button type="submit" className="btn-primary !py-2 !px-3" data-testid="search-submit">{t("nav.search_button")}</button>
                            </form>
                            {showResults && results.length > 0 && (
                                <div className="absolute left-0 right-0 top-full bg-white border border-black border-t-0 max-h-80 overflow-auto z-50" data-testid="search-results">
                                    {results.map((r, i) => (
                                        <button
                                            key={i}
                                            onClick={() => go(r.symbol)}
                                            className="w-full text-left px-3 py-2 hover:bg-[#F5E4D4] border-b border-black/10 flex justify-between items-center text-sm"
                                            data-testid={`search-result-${r.symbol}`}
                                        >
                                            <div>
                                                <span className="font-mono font-semibold">{r.symbol}</span>
                                                <span className="ml-2 text-[#4A4A4A]">{r.name}</span>
                                            </div>
                                            <span className="overline text-[#4A4A4A]">{r.exchange}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="shrink-0">
                            <AuthButton />
                        </div>
                    </div>

                    {/* Row 2: Nav links · Utility toggles */}
                    <div className="py-2 flex items-center justify-between gap-4 flex-wrap">
                        <nav className="flex items-center gap-1 flex-wrap">
                            <Link to="/" className={navClass("/")} data-testid="nav-link-home">{t("nav.home")}</Link>
                            <Link to="/portfolio" className={navClass("/portfolio")} data-testid="nav-link-portfolio">{t("nav.portfolio")}</Link>
                            <Link to="/watchlist" className={navClass("/watchlist")} data-testid="nav-link-watchlist">{t("nav.watchlist")}</Link>
                            <Link to="/compare" className={navClass("/compare")} data-testid="nav-link-compare">{t("nav.compare")}</Link>
                            <Link to="/thesis" className={navClass("/thesis")} data-testid="nav-link-thesis">{t("nav.thesis")}</Link>
                            <Link to="/visual" className={navClass("/visual")} data-testid="nav-link-visual">Visual</Link>
                        </nav>
                        <div className="flex items-center gap-1 flex-wrap">
                            <ThresholdsDialog />
                            <LanguageToggle />
                            <ThemeToggle />
                            <CurrencySelector />
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">{children}</main>

            <footer className="border-t border-black/30 py-4 px-6 text-xs text-[#4A4A4A]" data-testid="footer">
                <div className="max-w-[1400px] mx-auto space-y-2">
                    <div className="border border-[#B32A22]/40 bg-white/60 px-3 py-2 text-[11px] leading-relaxed" data-testid="legal-disclaimer">
                        <span className="font-mono font-semibold text-[#B32A22] mr-1">{t("footer.legal_tag")}</span>
                        {t("footer.legal")}
                    </div>
                    <div className="flex justify-between">
                        <span>Valuation Studio · Datos: Yahoo Finance</span>
                        <span className="font-mono">v1.0</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
