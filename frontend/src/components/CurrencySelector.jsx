import React from "react";
import { useFx, SUPPORTED_CURRENCIES } from "@/lib/fx";
import { Globe } from "lucide-react";

export default function CurrencySelector() {
    const { display, setDisplay, ready } = useFx();
    return (
        <label className="flex items-center gap-1" title="Moneda para mostrar precios">
            <Globe size={12} className="text-[#4A4A4A]" />
            <select
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                disabled={!ready}
                className="input-paper font-mono text-xs !py-0 !px-1"
                data-testid="currency-selector"
            >
                <option value="NATIVE">Nativa</option>
                {SUPPORTED_CURRENCIES.filter(c => c !== "NATIVE").map(c => (
                    <option key={c} value={c}>{c}</option>
                ))}
            </select>
        </label>
    );
}
