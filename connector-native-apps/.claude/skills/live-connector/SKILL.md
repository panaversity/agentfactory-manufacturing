---
name: live-connector
description: Expose the local connector gateway over a free Cloudflare quick-tunnel (auth OFF) so a claude.ai or ChatGPT custom connector can reach it, and hand the human the public URL. Use this for Part 5 whenever someone wants to run their connector live, get the connector URL, (re)start or refresh the tunnel, or take it down. This is the auth-OFF demo path (AUTH_DISABLED=1); real OAuth + a real sign-in service is the AI Identity course.
---

# Live connector — a public tunnel for the Part 5 demo (auth OFF)

This brings the human's local gateway up as a **public HTTPS URL** that Anthropic's / OpenAI's
cloud can reach, so they can add it as a custom connector in **claude.ai** and use their whole app.
It is thin orchestration over `cloudflared` + the gateway + `.env` — no new server, no real
sign-in service. **This is the auth-OFF demo path.** Real, multi-user OAuth is the AI Identity
course; do not stand up an authorization server here.

## The model: auth OFF, tunnel to port 8000

- **Auth is OFF** for this demo: `.env` has `AUTH_DISABLED=1`, so the gateway skips OAuth, returns
  no 401, and `begin_session` uses the fixed `DEV_SUB`. claude.ai accepts a no-auth remote MCP URL
  (OAuth is optional in its Add-custom-connector dialog), so this is enough to connect.
- **The gateway must run on `127.0.0.1:8000`** (`uv run python -m connector_app.server`). The tunnel
  is pinned to that port.
- **A Cloudflare quick-tunnel URL is ephemeral** — new every start. Start the tunnel, read its URL,
  hand it over; if you restart it, the URL changes and the human re-adds it in claude.ai.

## Turn it ON (go live)

Run from the repo root. Run the long-lived ones (cloudflared, the server) as **background**
processes; the waits/checks are foreground.

0. **Preflight — install `cloudflared` if missing** (covers macOS, Windows, Linux/WSL). On Windows,
   run these under **WSL** or **Git Bash** (the heredocs and `pkill` need a POSIX shell; in native
   PowerShell stop processes with `taskkill /IM cloudflared.exe /F` and `taskkill /IM python.exe /F`):
   ```bash
   command -v cloudflared >/dev/null || {
     echo "cloudflared missing — installing…"
     if   command -v brew    >/dev/null; then brew install cloudflared
     elif command -v winget  >/dev/null; then winget install --id Cloudflare.cloudflared -e --silent
     elif command -v choco   >/dev/null; then choco install cloudflared -y
     elif command -v scoop   >/dev/null; then scoop install cloudflared
     elif command -v apt-get >/dev/null; then
       curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
       echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
         | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
       sudo apt-get update -qq && sudo apt-get install -y cloudflared
     else echo "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2; fi
   }
   [ -f .env ] || cp .env.example .env
   command -v cloudflared && command -v uv   # both must resolve before continuing
   ```

1. **Turn auth off in `.env`** (edits only that one line; never echoes a secret):
   ```bash
   python3 -c "import re;p='.env';s=open(p).read();s=re.sub(r'(?m)^AUTH_DISABLED=.*$','AUTH_DISABLED=1',s) if re.search(r'(?m)^AUTH_DISABLED=',s) else s+'\nAUTH_DISABLED=1\n';open(p,'w').write(s)"
   ```

2. **Clear any stale tunnel/server** (a cloudflared process can outlive its edge connection):
   ```bash
   pkill -f "cloudflared tunnel"; pkill -f "connector_app.server"; sleep 2
   ```

3. **Start the gateway (background)** — it reads `.env`, so it comes up with auth OFF:
   ```bash
   uv run python -m connector_app.server > /tmp/gateway.log 2>&1     # run in the background
   until curl -s -o /dev/null http://127.0.0.1:8000/health 2>/dev/null \
      || curl -s -o /dev/null http://127.0.0.1:8000/mcp; do sleep 1; done
   ```

4. **Start the tunnel (background).** `--http-host-header 127.0.0.1:8000` is **required** — without
   it the random tunnel hostname trips the server's loopback / DNS-rebinding gate and every request
   fails with `421`:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8000 --http-host-header 127.0.0.1:8000 --no-autoupdate \
     > /tmp/cf.log 2>&1     # run in the background
   ```

5. **Read the assigned URL** (wait for it to print):
   ```bash
   until grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf.log; do sleep 1; done
   URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf.log | head -1); echo "$URL"
   ```

6. **Verify before handing it over** — auth is OFF, so an unauthenticated `tools/list` must return
   **200** (with auth on you would want 401; here you want 200):
   ```bash
   curl -s -o /dev/null -w "tunnel /mcp (no token) → HTTP %{http_code} (want 200)\n" -X POST "$URL/mcp" \
     -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   echo "CONNECTOR URL → $URL/mcp"
   ```

## What to hand the human (so they can connect)

- **Connector URL:** `$URL/mcp` (changes every tunnel start).
- **In claude.ai:** Settings → Connectors → **Add custom connector** → paste `$URL/mcp` → **Add**.
  No OAuth, no client_id, no Advanced settings — auth is off. Then ask the app to do its job; open a
  new chat and confirm the state carried over. **Re-add (not edit)** when the URL changes.

## Tell the human the truth (do not skip this)

- **Open door.** With auth off, anyone who has the tunnel URL can reach the tools and the Neon DB
  while it is up, and every caller is `DEV_SUB`. It is a personal demo, never a service.
- **Take it down when done:** `pkill -f "cloudflared tunnel"; pkill -f "connector_app.server"`.
- **Real sign-in is next.** Multi-user identity (real OAuth + a real authorization server) is the
  AI Identity course; that is when auth goes back on and strangers can actually sign in.

## Turn it OFF again (back to the secure default)

```bash
python3 -c "import re;p='.env';s=open(p).read();open(p,'w').write(re.sub(r'(?m)^AUTH_DISABLED=.*$','AUTH_DISABLED=0',s))"
pkill -f "cloudflared tunnel"; pkill -f "connector_app.server"
```

## Things that bite (so you don't relearn them)

- **The tunnel URL is ephemeral** — every `cloudflared` start gives a new hostname; the human re-adds
  it in claude.ai.
- **`421` on every tunneled request** → the `--http-host-header 127.0.0.1:8000` flag is missing.
- **Server on the wrong port** → the gateway must bind `127.0.0.1:8000`; the tunnel is pinned to it.
- **A stale `cloudflared`** can stay alive after its edge dies — always `pkill` and restart clean
  rather than trust an existing tunnel.
