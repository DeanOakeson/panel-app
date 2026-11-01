// Local stand-in for the Supabase Storage HTTP API, covering only what
// @supabase/storage-js sends for the calls panel-app makes:
//   upload           POST   /storage/v1/object/{bucket}/{path}        -> { Id, Key }
//   create signed URL POST  /storage/v1/object/sign/{bucket}/{path}   -> { signedURL }
//   signed download  GET    /storage/v1/object/sign/{bucket}/{path}?token=...
//   remove           DELETE /storage/v1/object/{bucket}  { prefixes } -> [objects]
// Two endpoints exist only for the tests:
//   GET  /health  answers once the stub is listening
//   POST /reset   deletes every stored object
// Objects live in memory and are gone when the process exits.
//
// Usage: node e2e/support/supabase-stub.mjs [--port 54321]

import http from "node:http";
import crypto from "node:crypto";

const portFlag = process.argv.indexOf("--port");
const PORT = Number(portFlag > -1 ? process.argv[portFlag + 1] : 54321);
const PREFIX = "/storage/v1";
const SECRET = crypto.randomBytes(32);

/** Stored objects by "bucket/path", each { id, body, contentType }. */
const objects = new Map();

/** Returns the signature a signed URL carries for an object key and expiry. */
function sign(key, expiresAt) {
  return crypto.createHmac("sha256", SECRET).update(`${key}\n${expiresAt}`).digest("base64url");
}

/** Sends a JSON body with a status code. */
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Sends an error shaped like Supabase Storage's. */
function sendError(response, status, message) {
  sendJson(response, status, { statusCode: String(status), error: http.STATUS_CODES[status], message });
}

/** Reads a request body into a Buffer. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** Reads a JSON request body, or an empty object when there is none. */
async function readJson(request) {
  const text = (await readBody(request)).toString();
  return text ? JSON.parse(text) : {};
}

/** Answers POST and GET on /object/sign/{key}: creating a signed URL, then serving it. */
async function handleSigned(request, response, url, key) {
  if (request.method === "POST") {
    const { expiresIn } = await readJson(request);
    if (!objects.has(key)) return sendError(response, 400, "Object not found");
    const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresIn ?? 60);
    return sendJson(response, 200, { signedURL: `/object/sign/${key}?token=${expiresAt}.${sign(key, expiresAt)}` });
  }

  if (request.method === "GET") {
    const [expiresAt, signature] = (url.searchParams.get("token") ?? "").split(".");
    if (!signature || signature !== sign(key, expiresAt)) return sendError(response, 400, "Invalid signature");
    if (Number(expiresAt) < Date.now() / 1000) return sendError(response, 400, "Token has expired");
    const stored = objects.get(key);
    if (!stored) return sendError(response, 404, "Object not found");
    const disposition = url.searchParams.has("download") ? "attachment" : "inline";
    response.writeHead(200, {
      "content-type": stored.contentType,
      "content-length": stored.body.length,
      "content-disposition": `${disposition}; filename="${key.split("/").pop()}"`,
    });
    return response.end(stored.body);
  }

  return sendError(response, 405, "Method not allowed");
}

/** Answers uploads and removals on /object/{bucket}/{path}. */
async function handleObject(request, response, key) {
  if (request.method === "POST" || request.method === "PUT") {
    const upsert = request.method === "PUT" || request.headers["x-upsert"] === "true";
    if (objects.has(key) && !upsert) return sendError(response, 409, "The resource already exists");
    const id = crypto.randomUUID();
    objects.set(key, {
      id,
      body: await readBody(request),
      contentType: request.headers["content-type"] ?? "application/octet-stream",
    });
    return sendJson(response, 200, { Id: id, Key: key });
  }

  if (request.method === "DELETE") {
    const bucket = key.replace(/\/$/, "");
    const { prefixes = [] } = await readJson(request);
    const removed = [];
    for (const objectPath of prefixes) {
      const stored = objects.get(`${bucket}/${objectPath}`);
      if (!stored) continue;
      objects.delete(`${bucket}/${objectPath}`);
      removed.push({
        name: objectPath,
        bucket_id: bucket,
        id: stored.id,
        metadata: { size: stored.body.length, mimetype: stored.contentType },
      });
    }
    return sendJson(response, 200, removed);
  }

  return sendError(response, 405, "Method not allowed");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/health") return sendJson(response, 200, { ok: true });

    if (url.pathname === "/reset" && request.method === "POST") {
      objects.clear();
      return sendJson(response, 200, { ok: true });
    }

    if (!url.pathname.startsWith(`${PREFIX}/object/`)) return sendError(response, 404, "Not found");

    const key = decodeURIComponent(url.pathname.slice(`${PREFIX}/object/`.length));

    if (key.startsWith("sign/")) return await handleSigned(request, response, url, key.slice("sign/".length));

    return await handleObject(request, response, key);
  } catch (error) {
    console.error(error);
    return sendError(response, 500, error.message);
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Supabase Storage stub on http://127.0.0.1:${PORT}${PREFIX}`));
