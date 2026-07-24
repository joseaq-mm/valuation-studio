// Custom Google OAuth 2.0 (Authorization Code flow) with our own Client ID.
// Redirects the browser to Google; Google returns to <origin>/auth/google?code=...,
// which posts the code to the backend for a server-side exchange (needs the secret).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
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
    window.location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}
