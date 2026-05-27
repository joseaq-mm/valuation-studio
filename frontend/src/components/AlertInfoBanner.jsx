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
            <div className="flex-1 min-w-[260px] space-y-1">
                <div className="overline text-[#4A4A4A]">Alertas por email — campanita</div>
                <div className="text-[#4A4A4A] leading-relaxed">
                    Cuando una acción tiene la campanita <span className="font-semibold" style={{ color: "var(--cheap)" }}>activada</span>, cada noche (06:00 UTC) revisamos su Ratio Compra y te enviamos un email si <span className="text-[#1D7044] font-semibold">cruza a BARATA</span> o <span className="text-[#B32A22] font-semibold">deja de estar barata</span> según tus umbrales configurados. La campanita de la cabecera activa/desactiva todas las filas a la vez.
                </div>
                <div className="text-xs text-[#4A4A4A] opacity-90">
                    {defaultLine} Requiere iniciar sesión con Google para recibir los emails.
                </div>
            </div>
        </div>
    );
}
