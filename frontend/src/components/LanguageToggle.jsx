import React from "react";
import { useI18n } from "@/lib/i18n";

export default function LanguageToggle() {
    const { lang, setLang } = useI18n();
    const next = lang === "es" ? "en" : "es";
    return (
        <button
            onClick={() => setLang(next)}
            className="btn-ghost !py-1 !px-2 text-xs font-mono"
            data-testid="lang-toggle"
            title={lang === "es" ? "Switch to English" : "Cambiar a español"}
        >
            {lang.toUpperCase()}
        </button>
    );
}
