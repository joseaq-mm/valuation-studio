# Auth Testing Playbook (Emergent Google Auth)

This file documents how to test the Google Auth flow integrated in Valuation Studio.

## Quick Reference
- Auth provider: Emergent-managed Google OAuth.
- Frontend hits: `https://auth.emergentagent.com/?redirect=<dashboard URL>` for login.
- After OAuth, the user lands at `<dashboard URL>#session_id=<id>` and the frontend
  posts that session_id to `/api/auth/session` which returns user data and sets a
  `session_token` httpOnly cookie (7d expiry).
- Logout: `POST /api/auth/logout` clears the cookie and deletes the session.

## Step 1 — Create Test User & Session via Mongo
```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2 — Backend API Smoke Test
```bash
API=$(grep REACT_APP_BACKEND_URL frontend/.env | cut -d'=' -f2)

# Auth probe (no cookie) — should 401
curl -i "$API/api/auth/me"

# Auth probe with bearer token (fallback path)
curl -i "$API/api/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Pull watchlist (returns [] if empty)
curl -i "$API/api/watchlist" -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Push watchlist
curl -i -X PUT "$API/api/watchlist" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"entries":[{"ticker":"AAPL","mode":"auto","overrides":null,"saved_at":"2026-02-01T10:00:00Z"}]}'
```

## Step 3 — Browser Testing (Playwright)
```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "your-app.preview.emergentagent.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto("https://valuation-studio.preview.emergentagent.com/watchlist")
```

## Checklist
- [ ] `users` document has `user_id` (uuid, custom) — never relies on `_id`.
- [ ] `user_sessions.user_id` matches `users.user_id` exactly.
- [ ] All Mongo reads use `{"_id": 0}` projection.
- [ ] `/api/auth/me` works with cookie AND `Authorization: Bearer` header.
- [ ] Watchlist sync only triggers when authenticated; anonymous users keep localStorage.
- [ ] Logout deletes session and clears cookie (subsequent `/auth/me` → 401).

## Clean test data
```bash
mongosh --eval "
use('test_database');
db.users.deleteMany({email: /test\.user\./});
db.user_sessions.deleteMany({session_token: /test_session/});
"
```
