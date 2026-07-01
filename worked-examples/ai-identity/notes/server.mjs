// Notes — a SEPARATE app that signs people in with AuthCo.
// Plain node:http + jose. No AuthCo code, no database, no BETTER_AUTH_SECRET.
import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  newPkce,
  buildAuthorizeUrl,
  exchangeCode,
  verifyIdToken,
  config,
} from "./lib/oauth.mjs";

const PORT = Number(process.env.NOTES_PORT ?? 4000);

// In-memory stores — Notes holds no signing secret at all.
const sessions = new Map(); // sid -> { claims, tokens }
const pending = new Map(); // state -> { verifier }

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function parseCookies(req) {
  const out = {};
  (req.headers.cookie ?? "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function send(res, status, html, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}
function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}
function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:6rem auto;padding:0 1rem;color:#111}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:1.5rem}
  a.btn,button{display:inline-block;background:#111;color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;text-decoration:none;font-size:.95rem;cursor:pointer}
  dt{color:#6b7280;font-size:.85rem}dd{margin:0 0 .6rem;font-weight:600}code{font-size:.8rem}</style></head>
  <body>${body}</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, config.NOTES_BASE);
  const cookies = parseCookies(req);

  try {
    // --- home ---
    if (url.pathname === "/" && req.method === "GET") {
      return send(res, 200, page("Notes", `<div class="card">
        <h1>Notes</h1>
        <p>A separate app. It trusts AuthCo's tokens without sharing any secret.</p>
        <a class="btn" href="/login">Sign in with AuthCo</a></div>`));
    }

    // --- start login: PKCE + redirect the browser to AuthCo ---
    if (url.pathname === "/login" && req.method === "GET") {
      const { verifier, challenge, state } = newPkce();
      pending.set(state, { verifier, at: Date.now() });
      const authorizeUrl = await buildAuthorizeUrl({ challenge, state });
      return redirect(res, authorizeUrl);
    }

    // --- OAuth callback: exchange code, verify OFFLINE, start Notes session ---
    if (url.pathname === "/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      if (err) return send(res, 400, page("Sign-in failed", `<div class="card"><h1>Sign-in failed</h1><p>AuthCo returned: <code>${esc(err)}</code></p></div>`));
      const p = state && pending.get(state);
      if (!p) return send(res, 400, page("Sign-in failed", `<div class="card"><h1>Bad state</h1><p>Unknown or expired login attempt.</p></div>`));
      pending.delete(state);

      const tok = await exchangeCode({ code, verifier: p.verifier });
      if (tok.status !== 200 || !tok.data?.id_token) {
        return send(res, 502, page("Sign-in failed", `<div class="card"><h1>Token exchange failed</h1><p>AuthCo said ${tok.status}.</p></div>`));
      }
      // Verify offline against AuthCo's JWKS (no secret, no DB).
      let claims;
      try {
        ({ payload: claims } = await verifyIdToken(tok.data.id_token));
      } catch (e) {
        return send(res, 401, page("Sign-in failed", `<div class="card"><h1>Token did not verify</h1><p><code>${esc(e.code ?? e.message)}</code></p></div>`));
      }
      const sid = randomBytes(18).toString("base64url");
      sessions.set(sid, { claims, refreshToken: tok.data.refresh_token ?? null });
      return redirect(res, "/dashboard", {
        "Set-Cookie": `notes_sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      });
    }

    // --- protected page: Notes's own signed-in view ---
    if (url.pathname === "/dashboard" && req.method === "GET") {
      const sess = cookies.notes_sid && sessions.get(cookies.notes_sid);
      if (!sess) return redirect(res, "/");
      const c = sess.claims;
      const idRows =
        (c.name ? `<dt>Name</dt><dd>${esc(c.name)}</dd>` : "") +
        (c.email ? `<dt>Email</dt><dd>${esc(c.email)}</dd>` : "");
      return send(res, 200, page("Notes — signed in", `<div class="card">
        <h1>Signed in</h1>
        <p>Verified offline from AuthCo's token. Notes never received your AuthCo credentials &mdash; only a code, then tokens.</p>
        <dl>
          ${idRows}
          <dt>Subject (sub)</dt><dd><code>${esc(c.sub)}</code></dd>
          <dt>Issued by (iss)</dt><dd><code>${esc(c.iss)}</code></dd>
          <dt>Audience (aud)</dt><dd><code>${esc(JSON.stringify(c.aud))}</code></dd>
          <dt>Expires (exp)</dt><dd><code>${esc(new Date(c.exp * 1000).toISOString())}</code></dd>
        </dl>
        <a class="btn" href="/logout">Sign out</a></div>`));
    }

    if (url.pathname === "/logout" && req.method === "GET") {
      if (cookies.notes_sid) sessions.delete(cookies.notes_sid);
      return redirect(res, "/", { "Set-Cookie": "notes_sid=; Path=/; Max-Age=0" });
    }

    return send(res, 404, page("Not found", `<div class="card"><h1>404</h1></div>`));
  } catch (e) {
    // Never logs tokens or secrets — just the route + error name.
    console.error(`[notes] ${req.method} ${url.pathname} error: ${e?.name ?? "Error"}`);
    return send(res, 500, page("Error", `<div class="card"><h1>Something went wrong</h1></div>`));
  }
});

server.listen(PORT, () => console.log(`[notes] listening on ${config.NOTES_BASE} (client_id=${config.CLIENT_ID})`));
