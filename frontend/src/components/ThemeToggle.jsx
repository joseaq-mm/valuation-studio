import React, { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const KEY = "vs.theme";

// Initialise the theme as early as possible to avoid flash-of-light-content.
// This runs synchronously on import (before React renders).
if (typeof document !== "undefined") {
    try {
        const stored = window.localStorage.getItem(KEY);
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        const initial = stored || (prefersDark ? "dark" : "light");
        document.documentElement.setAttribute("data-theme", initial);
    } catch {
        document.documentElement.setAttribute("data-theme", "light");
    }
}

export default function ThemeToggle() {
    const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try { window.localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    }, [theme]);

    const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
    const isDark = theme === "dark";

    return (
        <button
            onClick={toggle}
            className="btn-ghost flex items-center gap-2 !py-1 !px-2 text-xs"
            data-testid="theme-toggle"
            title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
    );
}
