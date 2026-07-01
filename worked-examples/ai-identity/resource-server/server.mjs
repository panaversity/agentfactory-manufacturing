// A tiny protected API — the resource server. Plain node:http + jose.
// One protected route. Identity comes ONLY from the verified token's `sub`,
// never from anything in the request.
import http from "node:http";
import { verifyAccessToken, verifyConfig } from "./lib/verify.mjs";

const PORT = Number(process.env.RESOURCE_PORT ?? 8000);

function json(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(obj));
}
function bearer(req) {
  const h = req.headers["authorization"] ?? "";
  const [scheme, value] = h.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value.trim() : undefined;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, verifyConfig.RESOURCE_URL);

  if (url.pathname === "/" && req.method === "GET") {
    return json(res, 200, { service: "notes-api", audience: verifyConfig.RESOURCE_URL });
  }

  // Protected resource.
  if (url.pathname === "/api/resource" && req.method === "GET") {
    const token = bearer(req);
    if (!token) {
      return json(res, 401, { error: "missing_bearer_token" }, { "WWW-Authenticate": "Bearer" });
    }
    let payload;
    try {
      ({ payload } = await verifyAccessToken(token));
    } catch (e) {
      // 401 + RFC 6750 challenge. Never log the token; just the reason code.
      return json(res, 401, { error: "invalid_token", reason: e?.code ?? "verify_failed" },
        { "WWW-Authenticate": `Bearer error="invalid_token"` });
    }
    // Identity is taken ONLY from the verified `sub`.
    return json(res, 200, {
      message: "access granted",
      user: payload.sub,
      verified: { iss: payload.iss, aud: payload.aud, exp: payload.exp },
    });
  }

  return json(res, 404, { error: "not_found" });
});

server.listen(PORT, () =>
  console.log(`[resource-server] listening on ${verifyConfig.RESOURCE_URL} (aud=${verifyConfig.RESOURCE_URL}, alg=RS256)`)
);
