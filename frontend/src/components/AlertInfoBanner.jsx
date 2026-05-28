import React from "react";
import { Bell } from "lucide-react";

/**
 * Wide info banner shown above the Watchlist / Portfolio table that explains
 * what the alert bell does and the default-state philosophy for each page.
 *
 * Style is intentionally subdued (no toggle inside) so it does not compete
 * with the table — purely informational.
 */
export default function AlertInfoBanner({ context = "watchlist" }) {
    const isPortfolio = context === "portfolio";
    const defaultLine = isPortfolio
        ? <>En esta página las alertas se <span className="font-semibold text-[#1D7044]">activan por defecto</span> al añadir una posición (te interesa que te avisen de lo que ya tienes en cartera).</>
        : <>En esta página las alertas vienen <span className="font-semibold">desactivadas por defecto</span> al añadir una empresa, para evitar ruido en listas amplias de seguimiento — activa la campanita en las que de verdad quieras vigilar.</>;

    return (
        <div className="border border-black bg-white p-4 mb-6 flex flex-wrap items-start gap-3 text-sm" data-testid={`alert-info-${context}`}>
            <div className="shrink-0 w-8 h-8 border border-black flex items-center justify-center" style={{ background: "var(--cheap)", color: "var(--text-on-dark)" }}>
                <Bell size={16} />
            </div>
            <div className="flex-1 min-w-[260px] space-y-2">
                <div className="overline text-[#4A4A4A]">Alertas por email — campanita</div>
                <div className="text-[#4A4A4A] leading-relaxed">
                    Cuando una acción tiene la campanita <span className="font-semibold" style={{ color: "var(--cheap)" }}>activada</span>, cada noche (06:00 UTC) revisamos sus ratios y te enviamos un email en <span className="font-semibold">dos situaciones</span>:
                </div>
                <ul className="text-[#4A4A4A] leading-relaxed list-disc pl-5 space-y-0.5">
                    <li>El precio <span className="text-[#1D7044] font-semibold">cruza a BARATA</span> según tu <span className="font-semibold">Ratio Compra</span> (precio actual ≤ POC, tu precio objetivo de compra).</li>
                    <li>El precio <span className="text-[#B32A22] font-semibold">cruza a CARA</span> según tu <span className="font-semibold">Ratio Venta</span> (precio actual ≥ POV, tu precio objetivo de venta — momento natural de plantearse vender).</li>
                </ul>
                <div className="text-[#4A4A4A] leading-relaxed">
                    La campanita de la cabecera activa/desactiva todas las filas a la vez.
                </div>
                <div className="text-xs text-[#4A4A4A] opacity-90 pt-1 border-t border-black/10">
                    {defaultLine} Requiere iniciar sesión con Google para recibir los emails.
                </div>
            </div>
        </div>
    );
}
