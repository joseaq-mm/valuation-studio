// Custom Google OAuth 2.0 (Authorization Code flow) with our own Client ID.
// Redirects the browser to Google; Google returns to <origin>/auth/google?code=...,
// which posts the code to the backend for a server-side exchange (needs the secret).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH

// Google refuses to render its consent screen inside an <iframe> (X-Frame-Options /
// 403 disallowed_useragent). The Emergent preview shows the app inside an iframe, so
// when we detect we're framed we open the login in a NEW top-level tab where Google
// works normally; otherwise we redirect in place.
function inIframe() {
    try { return window.self !== window.top; } catch { return true; }
}

export function startGoogleLogin() {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const redirectUri = window.location.origin + "/auth/google";
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "online",
        include_granted_scopes: "true",
        prompt: "select_account",
    });
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();

    if (inIframe()) {
        // Open at top level in a new tab (Google won't render inside the preview iframe).
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
            // Popup blocked → break out of the iframe by navigating the top window.
            try { window.top.location.href = url; } catch { window.location.href = url; }
        }
        return;
    }
    window.location.href = url;
}
