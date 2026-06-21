import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Compass } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTour } from "@/lib/tour";
import { HomeSearch } from "@/components/HomeSearch";

const POPULAR = [
    { sym: "AAPL", name: "Apple Inc." },
    { sym: "MSFT", name: "Microsoft Corp." },
    { sym: "GOOGL", name: "Alphabet" },
    { sym: "NVDA", name: "NVIDIA" },
    { sym: "META", name: "Meta Platforms" },
    { sym: "TSLA", name: "Tesla" },
    { sym: "SAN.MC", name: "Banco Santander" },
    { sym: "ITX.MC", name: "Inditex" },
    { sym: "SAP.DE", name: "SAP SE" },
    { sym: "ASML.AS", name: "ASML Holding" },
    { sym: "VOD.L", name: "Vodafone" },
    { sym: "AMZN", name: "Amazon" },
];

export default function Home() {
    const { t } = useI18n();
    const tour = useTour();
    return (
        <div data-testid="home-page">
            {/* Hero */}
            <section className="border border-black bg-white p-8 sm:p-12 mb-8" data-testid="hero-section">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="overline text-[#B32A22] mb-4">{t("home.tag")}</div>
                    <div className="flex items-center gap-2" data-testid="home-help-buttons">
                        <Link
                            to="/instrucciones"
                            className="flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold px-3 py-1.5 border border-black bg-white text-black hover:bg-black hover:text-[#FDF1E6] transition-colors"
                            data-testid="home-btn-instructions"
                        >
                            <BookOpen size={14} /> {t("home.instructions")}
                        </Link>
                        <button
                            onClick={() => tour && tour.start()}
                            className="flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] font-semibold px-3 py-1.5 border border-black bg-[#052049] text-white hover:bg-black transition-colors"
                            data-testid="home-btn-tour"
                        >
                            <Compass size={14} /> {t("home.tour")}
                        </button>
                    </div>
                </div>
                <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-none font-medium mb-6 max-w-3xl">
                    {t("home.hero_title_pre")} <em className="text-[#B32A22]">{t("home.hero_title_em_cara")}</em> {t("home.hero_title_or")} <em className="text-[#1D7044]">{t("home.hero_title_em_barata")}</em>.
                </h1>
                <div className="flex flex-col lg:flex-row lg:items-center gap-6 mb-6">
                    <p className="text-base sm:text-lg text-[#4A4A4A] max-w-2xl">
                        {t("home.hero_sub")}
                    </p>
                    <div className="lg:ml-auto shrink-0">
                        <HomeSearch />
                    </div>
                </div>
                <div className="flex flex-wrap gap-3 items-center text-sm">
                    <span className="overline text-[#4A4A4A]">{t("home.try_with")}</span>
                    {POPULAR.slice(0, 6).map(p => (
                        <Link key={p.sym} to={`/company/${p.sym}`} className="btn-ghost" data-testid={`hero-quick-${p.sym}`}>
                            {p.sym}
                        </Link>
                    ))}
                </div>
            </section>

            {/* Method */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-black mb-8" data-testid="method-section">
                {[
                    { n: "01", t: t("home.method_01_t"), d: t("home.method_01_d") },
                    { n: "02", t: t("home.method_02_t"), d: t("home.method_02_d") },
                    { n: "03", t: t("home.method_03_t"), d: t("home.method_03_d") },
                ].map((s, i) => (
                    <div key={i} className={`p-6 bg-white ${i < 2 ? 'md:border-r border-black' : ''} ${i < 2 ? 'border-b md:border-b-0 border-black' : ''}`}>
                        <div className="font-mono text-5xl text-[#B32A22] mb-2">{s.n}</div>
                        <div className="font-serif text-2xl mb-2">{s.t}</div>
                        <div className="text-sm text-[#4A4A4A]">{s.d}</div>
                    </div>
                ))}
            </section>

            {/* Popular */}
            <section data-testid="popular-section">
                <div className="flex justify-between items-end mb-4">
                    <h2 className="font-serif text-3xl">{t("home.popular_title")}</h2>
                    <Link to="/compare" className="overline text-[#052049] hover:underline" data-testid="link-compare">{t("home.compare_companies")} <ArrowRight size={12} className="inline" /></Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-0 border border-black bg-white">
                    {POPULAR.map((p, i) => (
                        <Link
                            key={p.sym}
                            to={`/company/${p.sym}`}
                            className="p-4 border-r border-b border-black/20 hover:bg-[#F5E4D4] transition-colors"
                            data-testid={`popular-${p.sym}`}
                        >
                            <div className="font-mono text-lg font-semibold">{p.sym}</div>
                            <div className="text-xs text-[#4A4A4A]">{p.name}</div>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
