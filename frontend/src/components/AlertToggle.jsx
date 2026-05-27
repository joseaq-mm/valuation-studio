import React from "react";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import HoverTip from "@/components/HoverTip";
import { toast } from "sonner";

/**
 * Compact bell toggle that turns the per-row email alert on/off for a single
 * ticker. Requires the user to be authenticated; otherwise it just nudges them
 * to log in (we don't want anonymous "alerts" with nowhere to send the email).
 *
 * Props:
 *   - enabled (bool): current state
 *   - onChange (bool => void): called with the new state
 *   - testid (string): suffix for data-testid
 */
export default function AlertToggle({ enabled, onChange, testid }) {
    const { user } = useAuth();
    const { t } = useI18n();
    const handle = () => {
        if (!user) {
            toast.message(t("alerts.requires_login"));
            return;
        }
        onChange(!enabled);
    };

    const headline = !user
        ? t("alerts.requires_login")
        : enabled ? "Alertas ACTIVADAS para este ticker" : "Alertas DESACTIVADAS para este ticker";

    const tip = (
        <div className="space-y-2 text-left">
            <div className="font-semibold">{headline}</div>
            <div>
                Cuando están activadas, cada noche (06:00 UTC) te enviamos un email si la acción <span className="text-[var(--cheap)] font-semibold">cruza a BARATA</span> o <span className="text-[var(--crimson)] font-semibold">deja de estar barata</span> según tu Ratio Compra y tus umbrales configurados.
            </div>
            <div className="text-[11px] opacity-80 pt-1 border-t border-white/20">
                Por defecto: <span className="font-semibold">Cartera ACTIVADAS</span> (te interesa que te avisen de lo que ya tienes) · <span className="font-semibold">Watchlist DESACTIVADAS</span> (lista amplia de seguimiento — activa sólo los tickers que de verdad te interesa vigilar para no recibir spam).
            </div>
            {!user && (
                <div className="text-[11px] text-[#F5C04A]">Requiere iniciar sesión con Google para recibir emails.</div>
            )}
        </div>
    );

    return (
        <HoverTip text={tip}>
            <button
                type="button"
                onClick={handle}
                aria-pressed={!!enabled}
                className="inline-flex items-center justify-center w-7 h-7 border"
                style={{
                    background: enabled ? "var(--cheap)" : "transparent",
                    borderColor: enabled ? "var(--cheap)" : "var(--border-strong)",
                    color: enabled ? "var(--text-on-dark)" : (user ? "var(--text-primary)" : "var(--text-secondary)"),
                    opacity: user ? 1 : 0.55,
                }}
                data-testid={`alert-toggle-${testid}`}
            >
                {enabled ? <Bell size={12} /> : <BellOff size={12} />}
            </button>
        </HoverTip>
    );
}
