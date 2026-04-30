# QuickBooks Online Integration

Server-to-server OAuth 2.0 integration with QuickBooks Online (QBO).  
After a single manual authorization, the server refreshes tokens autonomously and survives restarts indefinitely.

---

## 1 — Create the app in Intuit Developer

1. Go to <https://developer.intuit.com/app/developer/myapps> → **Create an app**
2. Select **QuickBooks Online and Payments**
3. Under **Keys & credentials**, copy **Client ID** and **Client Secret**
4. Add your redirect URI under **Redirect URIs**:
   - Development: `http://localhost:8080/quickbooks/callback`
   - Production: `https://yourdomain.com/quickbooks/callback` (must be HTTPS)
5. Set **Scopes** → enable `com.intuit.quickbooks.accounting`

---

## 2 — Required environment variables

Add these to your `.env`:

```env
# QuickBooks Online
QB_CLIENT_ID=ABc123...            # from Intuit Developer console
QB_SECRET_KEY=XYz456...           # from Intuit Developer console
QB_REDIRECT_URI=https://yourdomain.com/quickbooks/callback
QB_ENVIRONMENT=sandbox            # or: production
QB_ENCRYPTION_KEY=                # 64 hex chars — generate with: openssl rand -hex 32
```

Generate the encryption key:

```bash
openssl rand -hex 32
```

---

## 3 — First authorization (one-time, manual)

1. Start the server
2. Open a browser and navigate to:
   ```
   GET /quickbooks/connect
   ```
3. You will be redirected to the Intuit consent screen
4. Log in with the QuickBooks account you want to connect and click **Connect**
5. Intuit redirects back to `/quickbooks/callback` automatically
6. The page confirms **"QuickBooks Connected"** — close the window

From this point the server handles all token rotation autonomously.

---

## 4 — Verify the connection

```
GET /quickbooks/status/:realmId
```

Returns `{ connected: true, companyName: "..." }` on success, or a 503 if reauthorization is needed.

---

## 5 — Automatic token maintenance

| Schedule | Action |
|---|---|
| Every 30 minutes | Refresh tokens expiring within the next 10 minutes |
| Every 12 hours | Health-refresh **all** connections (keeps refresh_token alive) |

If a refresh fails with `invalid_grant`, the event `qbo.connection.broken` is emitted with `{ realmId, requiresReauth: true }`. Subscribe to it to send alerts:

```typescript
@OnEvent('qbo.connection.broken')
handleBrokenConnection(payload: { realmId: string; requiresReauth: boolean }) {
  // send Slack alert, email, etc.
}
```

---

## 6 — Using the API from other modules

Inject `QuickbooksApiService` (exported from `QuickbooksModule`):

```typescript
constructor(private readonly qboApi: QuickbooksApiService) {}

// Example
const customer = await this.qboApi.getCustomer(realmId, customerId);
const result   = await this.qboApi.query(realmId, "SELECT * FROM Invoice");
```

`getValidAccessToken` is called automatically before every request and refreshes transparently. A 401 from Intuit triggers one automatic retry.

---

## 7 — Database

The integration uses the existing `qbo_connections` table — no migrations needed.  
Tokens are stored AES-256-GCM encrypted. The plaintext never touches the database.
