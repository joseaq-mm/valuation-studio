// Collects automatic diagnostic metadata + captures a page screenshot for feedback reports.

export function gatherMeta() {
    const ua = navigator.userAgent || "";
    const browser = /Edg/.test(ua) ? "Edge"
        : /OPR|Opera/.test(ua) ? "Opera"
        : /Chrome/.test(ua) ? "Chrome"
        : /Firefox/.test(ua) ? "Firefox"
        : /Safari/.test(ua) ? "Safari" : "Otro";
    const os = /Android/.test(ua) ? "Android"
        : /iPhone|iPad|iPod/.test(ua) ? "iOS"
        : /Windows/.test(ua) ? "Windows"
        : /Mac OS/.test(ua) ? "macOS"
        : /Linux/.test(ua) ? "Linux" : "Otro";
    return {
        browser,
        os,
        screen: `${window.screen.width}×${window.screen.height}`,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        dpr: window.devicePixelRatio || 1,
        language: navigator.language || "",
        path: window.location.pathname + window.location.search,
        user_agent: ua,
        at: new Date().toISOString(),
    };
}

// Captures the current page (excluding elements marked data-fb-ignore, i.e. the panel itself).
export async function captureScreenshot() {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        backgroundColor: "#FDF1E6",
        scale: Math.min(1.5, window.devicePixelRatio || 1),
        ignoreElements: (el) => el.hasAttribute && el.hasAttribute("data-fb-ignore"),
    });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
}
