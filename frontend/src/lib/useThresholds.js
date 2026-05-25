import { useEffect, useState } from "react";
import { loadThresholds } from "./thresholds";

/**
 * React hook: returns the current thresholds and re-renders the component
 * when they change in another tab/window or via the ThresholdsDialog.
 */
export const useThresholds = () => {
    const [t, setT] = useState(loadThresholds());
    useEffect(() => {
        const onChange = (e) => setT(e.detail || loadThresholds());
        const onStorage = (e) => { if (!e.key || e.key === "vs.thresholds.v1") setT(loadThresholds()); };
        window.addEventListener("vs:thresholds-changed", onChange);
        window.addEventListener("storage", onStorage);
        return () => {
            window.removeEventListener("vs:thresholds-changed", onChange);
            window.removeEventListener("storage", onStorage);
        };
    }, []);
    return t;
};
