import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { searchTickers } from "@/lib/api";
import { Search, Menu, X } from "lucide-react";
import ThresholdsDialog from "./ThresholdsDialog";
import ThemeToggle from "./ThemeToggle";
import AuthButton from "./AuthButton";
import CurrencySelector from "./CurrencySelector";
import LanguageToggle from "./LanguageToggle";
import HelpChat from "./HelpChat";
import { useI18n } from "@/lib/i18n";

export default function Layout({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const timer = useRef(null);
    const boxRef = useRef(null);

    useEffect(() => { setMenuOpen(false); }, [location.pathname]);

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

    const navClassMobile = (path) => `block text-sm uppercase tracking-[0.12em] font-semibold px-3 py-2.5 ${
        location.pathname === path || location.pathname.startsWith(path + "/")
            ? "bg-black text-[#FDF1E6]"
            : "text-black hover:bg-black/5"
    } transition-colors`;

    const links = [
        { to: "/", label: t("nav.home"), testid: "home" },
        { to: "/portfolio", label: t("nav.portfolio"), testid: "portfolio" },
        { to: "/watchlist", label: t("nav.watchlist"), testid: "watchlist" },
        { to: "/compare", label: t("nav.compare"), testid: "compare" },
        { to: "/thesis", label: t("nav.thesis"), testid: "thesis" },
        { to: "/visual", label: "Visual", testid: "visual" },
        { to: "/kpis", label: "KPIs", testid: "kpis" },
        { to: "/macro", label: "Macro", testid: "macro" },
    ];

    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-base)" }}>
            <header className="border-b border-black sticky top-0 z-40" style={{ background: "var(--bg-base)" }}>
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
                    {/* Row 1: Logo · Search · Auth (wraps on mobile) */}
                    <div className="py-3 flex items-center gap-3 sm:gap-6 border-b border-black/10 flex-wrap">
                        <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0 order-1" data-testid="nav-home">
                            <div className="w-8 h-8 border border-black flex items-center justify-center bg-white shrink-0">
                                <div className="w-3 h-3 bg-[#052049]" />
                            </div>
                            <div className="leading-none">
                                <div className="font-serif text-xl sm:text-2xl font-medium">Valuation Studio</div>
                                <div className="overline text-[#4A4A4A] hidden sm:block">Equity Research</div>
                            </div>
                        </Link>

                        <button
                            className="md:hidden order-2 ml-auto border border-black bg-white p-2"
                            onClick={() => setMenuOpen((o) => !o)}
                            aria-label="Menú"
                            data-testid="nav-mobile-toggle"
                        >
                            {menuOpen ? <X size={18} /> : <Menu size={18} />}
                        </button>

                        <div ref={boxRef} className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 relative">
                            <form onSubmit={handleSubmit} className="flex items-center border border-black bg-white" data-testid="search-form">
                                <Search size={16} className="ml-3 text-[#4A4A4A] shrink-0" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t("nav.search_placeholder")}
                                    className="flex-1 min-w-0 px-3 py-2 outline-none font-mono text-sm bg-transparent"
                                    data-testid="search-input"
                                    onFocus={() => results.length && setShowResults(true)}
                                />
                                <button type="submit" className="btn-primary !py-2 !px-3 shrink-0" data-testid="search-submit">{t("nav.search_button")}</button>
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

                        <div className="shrink-0 order-4 hidden md:block">
                            <AuthButton />
                        </div>
                    </div>

                    {/* Row 2 (desktop): Nav links · Utility toggles */}
                    <div className="py-2 hidden md:flex items-center justify-between gap-4 flex-wrap">
                        <nav className="flex items-center gap-1 flex-wrap">
                            {links.map((l) => (
                                <Link key={l.to} to={l.to} className={navClass(l.to)} data-testid={`nav-link-${l.testid}`}>{l.label}</Link>
                            ))}
                        </nav>
                        <div className="flex items-center gap-1 flex-wrap">
                            <HelpChat />
                            <ThresholdsDialog />
                            <LanguageToggle />
                            <ThemeToggle />
                            <CurrencySelector />
                        </div>
                    </div>

                    {/* Mobile menu (drawer) */}
                    {menuOpen && (
                        <div className="md:hidden py-2 border-t border-black/10" data-testid="nav-mobile-menu">
                            <nav className="flex flex-col">
                                {links.map((l) => (
                                    <Link key={l.to} to={l.to} className={navClassMobile(l.to)} data-testid={`nav-mlink-${l.testid}`}>{l.label}</Link>
                                ))}
                            </nav>
                            <div className="flex items-center gap-1 flex-wrap mt-2 pt-2 border-t border-black/10">
                                <HelpChat />
                                <ThresholdsDialog />
                                <LanguageToggle />
                                <ThemeToggle />
                                <CurrencySelector />
                            </div>
                            <div className="mt-2 pt-2 border-t border-black/10">
                                <AuthButton />
                            </div>
                        </div>
                    )}
                </div>
            </header>

            <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>

            <footer className="border-t border-black/30 py-4 px-4 sm:px-6 text-xs text-[#4A4A4A]" data-testid="footer">
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
