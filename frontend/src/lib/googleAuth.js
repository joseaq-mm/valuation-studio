// Custom Google OAuth 2.0 (Authorization Code flow) with our own Client ID.
// Redirects the browser to Google; Google returns to <origin>/auth/google?code=...,
// which posts the code to the backend for a server-side exchange (needs the secret).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH

// Google refuses to render its consent screen inside an <iframe> (X-Frame-Options /
// 403 disallowed_useragent). The Emergent preview shows the app inside an iframe, so
// when we're framed we open the login in a top-level POPUP (keeping window.opener so
// the popup can relay the session token back to the iframe) instead of redirecting.
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
        // Popup at top level (Google won't render inside the preview iframe). We DON'T pass
        // noopener because the popup must keep window.opener to postMessage the token back.
        // NOTE: never read window.top.* here — the top frame is cross-origin (the chat) and
        // accessing it throws a SecurityError.
        let win = null;
        try { win = window.open(url, "vs_google_login", "width=480,height=640"); } catch { win = null; }
        if (!win) {
            // Popup blocked → break out of the iframe by navigating the top window.
            try { window.top.location.href = url; } catch { window.location.href = url; }
        }
        return;
    }
    window.location.href = url;
}
