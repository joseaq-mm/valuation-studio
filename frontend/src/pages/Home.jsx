import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

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
    return (
        <div data-testid="home-page">
            {/* Hero */}
            <section className="border border-black bg-white p-8 sm:p-12 mb-8" data-testid="hero-section">
                <div className="overline text-[#B32A22] mb-4">Equity research · Análisis fundamental</div>
                <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-none font-medium mb-6 max-w-3xl">
                    Calcula si una acción está <em className="text-[#B32A22]">cara</em> o <em className="text-[#1D7044]">barata</em>.
                </h1>
                <p className="text-base sm:text-lg text-[#4A4A4A] max-w-2xl mb-6">
                    Tu sistema de valoración basado en proyecciones de ingresos, FCF, márgenes y crecimientos compuestos.
                    Aplicado a cualquier empresa cotizada del mundo, con datos siempre actualizados.
                </p>
                <div className="flex flex-wrap gap-3 items-center text-sm">
                    <span className="overline text-[#4A4A4A]">Prueba con</span>
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
                    { n: "01", t: "Ingiere", d: "Conecta cualquier ticker global (NYSE, NASDAQ, BME, Xetra, LSE, Euronext…) y descarga estados financieros e ingresos proyectados." },
                    { n: "02", t: "Calcula", d: "Aplica tus fórmulas propias: Ratio Compra y Ratio Venta, con proyecciones a 2 años, márgenes, FCF y crecimientos compuestos a 4 años." },
                    { n: "03", t: "Decide", d: "Visualiza la señal en verde / ámbar / rojo. Compara empresas, ajusta proyecciones a mano y mantén una watchlist." },
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
                    <h2 className="font-serif text-3xl">Mercados destacados</h2>
                    <Link to="/compare" className="overline text-[#052049] hover:underline" data-testid="link-compare">Comparar empresas <ArrowRight size={12} className="inline" /></Link>
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
