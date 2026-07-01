// A CIMD client's metadata host. Its `client_id` IS a URL on this server; AuthCo
// fetches the JSON document below on demand instead of keeping a registration.
// Plain node:http, no deps. Serves a valid document plus broken variants used to
// prove the issuer validates the document against the request.
import http from "node:http";

const PORT = Number(process.env.CIMD_PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;

// A valid OAuth client metadata document (RFC 7591-shaped). For CIMD the
// `client_id` field MUST equal the URL it is served from, and URL-valued fields
// (redirect_uris) must be same-origin as the client_id URL (originBoundFields).
const validDoc = (clientUrl) => ({
  client_id: clientUrl,
  client_name: "CIMD Demo Client",
  redirect_uris: [`${ORIGIN}/callback`],
  token_endpoint_auth_method: "none", // public client — PKCE only, no secret
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: "openid profile email",
});

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const self = ORIGIN + url.pathname;
  // Log every inbound fetch so we can see exactly what AuthCo requests.
  console.error(`[cimd-client] <- ${req.method} ${url.pathname}  (from ${req.headers["user-agent"] ?? "?"})`);

  // The valid metadata document. client_id == this URL.
  if (url.pathname === "/oauth-client.json") {
    return json(res, 200, validDoc(self));
  }

  // AC-6: document's self-declared client_id disagrees with its URL.
  if (url.pathname === "/wrong-client-id.json") {
    const doc = validDoc(self);
    doc.client_id = `${ORIGIN}/some-other-id.json`; // lies about its own identity
    return json(res, 200, doc);
  }

  // AC-6: document does NOT list the redirect_uri the request will ask for.
  if (url.pathname === "/no-redirect.json") {
    const doc = validDoc(self);
    doc.redirect_uris = [`${ORIGIN}/somewhere-else`];
    return json(res, 200, doc);
  }

  // AC-7: reachable but NOT JSON.
  if (url.pathname === "/not-json") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<html><body>I am not a metadata document.</body></html>");
  }

  // dummy callback target so redirects resolve
  if (url.pathname === "/callback") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok (callback)");
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => console.log(`[cimd-client] metadata host on ${ORIGIN} (client_id=${ORIGIN}/oauth-client.json)`));
