# DocuMind AI — Production Security Checklist

**Stack:** Express.js + TypeScript + Next.js 14 + Supabase + Upstash Redis + EC2 + Vercel  
**Last Updated:** 2026-07-07

---

## 1. Security Headers

### Backend (Helmet.js — `src/index.ts`)

| Header | Value | Status |
|--------|-------|--------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | ✅ |
| `X-Frame-Options` | `DENY` | ✅ |
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✅ |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | ✅ |
| `Content-Security-Policy` | Custom per-project directives | ✅ |
| `X-Request-ID` | Per-request UUID (tracing) | ✅ |

### Frontend (Next.js — `next.config.ts`)

| Header | Status |
|--------|--------|
| All 7 headers from backend (applied at Vercel edge) | ✅ |
| CSP scoped to backend API + Supabase + Groq | ✅ |
| Image allowlist locked to Supabase Storage hostname | ✅ |

### How to Test

```bash
# Test backend headers
curl -sI http://localhost:5001/ | grep -iE "strict-transport|x-frame|x-content|referrer|permissions|content-security|x-request"

# Test via securityheaders.com (production URL)
# https://securityheaders.com/?q=https://yourdomain.com&followRedirects=on
```

### What It Protects Against
- **HSTS**: Downgrade attacks (HTTP → HTTPS stripping via MITM)
- **X-Frame-Options + CSP frame-ancestors**: Clickjacking — embedding your page in a malicious `<iframe>`
- **X-Content-Type-Options**: MIME sniffing — browser executing `.txt` as JavaScript
- **Referrer-Policy**: Credential leakage via URL path in `Referer` header
- **Permissions-Policy**: Malicious scripts silently accessing camera/microphone/GPS
- **CSP**: XSS — restricts where scripts/styles/images/connections can load from

### Interview Talking Points
- "Helmet is a collection of 14 smaller middleware functions, each setting one or two headers. The key ones are HSTS (forces HTTPS), frameguard (clickjacking), noSniff (MIME sniffing), and CSP."
- "HSTS works by telling the browser: never attempt an HTTP connection to this domain for the next 365 days. Even if someone sends the user an `http://` link."
- "CSP's `frame-ancestors: 'none'` is the modern replacement for X-Frame-Options. I include both for compatibility with older browsers."

---

## 2. Request Validation with Zod

### Schemas (`src/validation/schemas.ts`)

| Schema | Endpoint | Validates |
|--------|----------|-----------|
| `registerSchema` | `POST /api/auth/register` | name (2-50 chars, unicode), email (RFC 5321, lowercase), password (8-128, complexity) |
| `loginSchema` | `POST /api/auth/login` | email, password (1-128 chars) |
| `querySchema` | `POST /api/query` | question (3-500 chars), documentId (UUID v4) |
| `queryHistoryParamsSchema` | `GET /api/query/history/:documentId` | documentId (UUID v4) |
| `documentIdParamSchema` | `GET/DELETE /api/documents/:id` | id (UUID v4) |

### How to Test

```bash
# Validation failure — missing fields
curl -s -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bad","password":"123"}' | jq .
# 400 with per-field errors

# Weak password
curl -s -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.com","password":"password"}' | jq .
# 400: "Password must contain at least one uppercase letter"

# Invalid UUID in route param
TOKEN="your-jwt-token"
curl -s http://localhost:5001/api/documents/not-a-uuid \
  -H "Authorization: Bearer $TOKEN" | jq .
# 400: "Must be a valid UUID"
```

### What It Protects Against
- **Type confusion injection**: `{"password": {"$gt": ""}}` NoSQL-style via JSON body
- **Oversized LLM prompts**: A 50,000-char question would blow Groq token limits and cost money
- **UUID injection**: Arbitrary strings in `:id` params cause unexpected DB behaviour
- **Password DoS**: bcrypt on a 1MB string takes minutes — max 128 chars prevents this

### Interview Talking Points
- "Zod's `safeParse` returns a discriminated union. I use it instead of `parse` so I can forward the `ZodError` to the central error handler rather than catching a thrown error in the middleware."
- "The `validate(schema, target)` factory pattern means I write the schema once and apply it in the route file. The controller never needs to check if fields exist."
- "I lowercase emails in the Zod schema with `.toLowerCase()` so 'User@EXAMPLE.COM' and 'user@example.com' always resolve to the same account."

---

## 3. Rate Limiting (Distributed, Redis-backed)

### Limiters (`src/middleware/rateLimiter.ts`)

| Limiter | Window | Max | Endpoints | Key Prefix |
|---------|--------|-----|-----------|------------|
| `authLimiter` | 15 min | 5 | POST /auth/login, /register | `rl:auth` |
| `uploadLimiter` | 15 min | 10 | POST /documents/upload | `rl:upload` |
| `queryLimiter` | 1 hour | 30 | POST /query | `rl:query` |
| `searchLimiter` | 1 hour | 100 | GET /documents, /history | `rl:search` |
| `generalLimiter` | 1 hour | 1000 | All routes (global) | `rl:general` |

### How to Test

```bash
# Trigger auth rate limit (6th request = 429)
for i in {1..6}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:5001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"WrongPass1!"}';
done
# First 5: 401, 6th: 429 with Retry-After header

# Inspect rate limit counter in Redis
redis-cli -u $REDIS_URL GET "rl:auth:<your-ip>"
```

### What It Protects Against
- **Credential stuffing**: Automated tools trying millions of email/password combos
- **Brute force login**: Exhausting password space on known accounts
- **LLM cost abuse**: Each Groq query costs money — 30/hour per IP keeps costs predictable
- **Queue saturation**: BullMQ async jobs; unlimited uploads could OOM the worker

### Interview Talking Points
- "I chose `rate-limiter-flexible` over `express-rate-limit` because express-rate-limit stores counters in memory per process. In a PM2 cluster with 4 workers, each has its own counter — effectively multiplying the limit by 4. Redis makes it truly distributed."
- "I fail open on Redis errors — if Redis is down, I call `next()` instead of 429. Tradeoff: brief window with no rate limiting vs. entire API going down because Redis is temporarily unreachable."
- "The auth limiter blocks for the full 15-minute window after 5 failed attempts (`blockDuration: 15 * 60`), matching OWASP's recommendation."

---

## 4. Secure Cookie Handling

**Decision:** DocuMind AI uses JWT Bearer tokens (Authorization header), not session cookies.

**Why this is secure:**
- JWTs in headers are not automatically sent by browsers (unlike cookies), so they're immune to CSRF by default
- No CSRF token middleware required
- No session storage required

**If switching to cookie-based auth in the future:**
```typescript
res.cookie('token', jwtToken, {
  httpOnly: true,    // JavaScript cannot read it (prevents XSS theft)
  secure: true,      // HTTPS only
  sameSite: 'lax',  // Sent on same-site requests + top-level navigations
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
});
```

---

## 5. CSRF Protection

**Status: Not required for this architecture.**

- JWT stored in memory/localStorage, sent as `Authorization: Bearer <token>` header
- Browsers do NOT automatically send Authorization headers with cross-origin requests
- A malicious page at `evil.com` cannot forge a request including the victim's JWT
- CSRF is only a concern when credentials are auto-sent (i.e., cookies)

**Test:**
```bash
# Verify requests without Authorization header are rejected
curl -s -X POST http://localhost:5001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question":"test","documentId":"valid-uuid"}' | jq .
# 401 Unauthorized
```

---

## 6. Input Sanitisation & Output Escaping

### Backend (`src/middleware/sanitize.ts`)

| Protection | Implementation |
|-----------|----------------|
| Whitespace trimming | `deepTrimStrings()` on all body string values |
| Email normalisation | `.toLowerCase()` in sanitizeBody + Zod schema |
| Prototype pollution prevention | Strip `__proto__`, `constructor`, `prototype` keys |
| File magic-byte validation | Read first 12 bytes, compare against known signatures |

### File Upload Magic Bytes Checked

| Format | Magic Bytes | Hex |
|--------|------------|-----|
| PDF | `%PDF` | `25 50 44 46` |
| DOCX (ZIP) | `PK` | `50 4B 03 04` |
| JPEG | `ÿØÿ` | `FF D8 FF` |
| PNG | `‰PNG\r\n\x1a\n` | `89 50 4E 47 0D 0A 1A 0A` |
| WebP | `RIFF....WEBP` | `52 49 46 46 ... 57 45 42 50` |

### How to Test

```bash
# Test prototype pollution stripping
curl -s -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"__proto__":{"isAdmin":true},"name":"Eve","email":"eve@test.com","password":"SecurePass1!"}' | jq .
# __proto__ key is silently stripped

# Test magic bytes (rename a PNG to .pdf)
cp test.png fake.pdf
curl -s -X POST http://localhost:5001/api/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@fake.pdf;type=application/pdf" | jq .
# 400: "File content does not match the declared file type"
```

### Interview Talking Points
- "MIME type checking from the client is just a hint — it can be spoofed. Checking magic bytes reads the actual file header from disk after multer saves it, so a renamed executable can't slip through."
- "Prototype pollution via JSON body: `{ '__proto__': { 'isAdmin': true } }` can pollute Object.prototype if you use `Object.assign()` on untrusted input. Stripping those keys prevents it."

---

## 7. Error Handling Middleware

### Error Type Mapping (`src/middleware/errorHandler.ts`)

| Error Type | HTTP Status | Client Message |
|-----------|-------------|----------------|
| `ZodError` | 400 | Field-level validation errors (safe) |
| `MulterError` | 400 | File-specific message (safe) |
| `TokenExpiredError` | 401 | "Your session has expired" |
| `JsonWebTokenError` | 401 | "Authentication token is invalid" |
| Prisma `P2002` | 409 | "A record with this [field] already exists" |
| Prisma `P2025` | 404 | "The requested record does not exist" |
| `AppError` (operational) | `err.statusCode` | `err.message` (intentionally safe) |
| Unknown errors | 500 | "Internal server error" |

### How to Test

```bash
# Zod error (400 with fields array)
curl -s -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.fields'

# Duplicate email (409 from Prisma P2002)
curl -s -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"existing@test.com","password":"SecurePass1!"}' | jq .

# Verify no stack trace in 500 response
NODE_ENV=production node dist/index.js &
curl -s http://localhost:5001/api/documents/not-found \
  -H "Authorization: Bearer $TOKEN" | jq 'has("stack")'
# false
```

### Interview Talking Points
- "The key insight is distinguishing operational errors (user tried to register with an existing email — expected, safe to communicate) from programmer errors (null pointer — unexpected, never expose). `AppError.isOperational` makes that distinction explicit."
- "I use `instanceof` checks in a specific order: ZodError first (it's also an Error), then library-specific errors, then AppError, then catch-all. Order matters."

---

## 8. Environment Variables & Secrets Management

### Validator (`src/config/env.ts`)

If any of the 12 required variables is missing, the server calls `process.exit(1)` before accepting connections.

```bash
# Test: start server without a required var
JWT_SECRET="" npm run dev
# "Missing required environment variables: JWT_SECRET"
# → process exits immediately

# Generate a cryptographically strong JWT secret
openssl rand -hex 64
```

### Production Secret Management

| Platform | Where to Store |
|----------|---------------|
| AWS EC2 | AWS Secrets Manager or Parameter Store |
| Vercel (frontend) | Project → Settings → Environment Variables |
| GitHub Actions | Repository → Settings → Secrets |
| Docker | Docker secrets or runtime env injection |

### Interview Talking Points
- "Never bake secrets into a Docker image — they're recoverable from layers with `docker history`. Use `--env-file` or runtime secret injection."
- "The startup validator uses `process.exit(1)` rather than throwing, because thrown errors in top-level module execution may be swallowed by some process managers."

---

## 9. Content Security Policy (CSP)

### Backend CSP Directives

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self';
connect-src 'self' [supabase-url] https://api.groq.com;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'self';
upgrade-insecure-requests (production only)
```

### How to Test

```bash
# Check CSP header
curl -sI http://localhost:5001/ | grep content-security-policy

# Validate CSP quality
# https://csp-evaluator.withgoogle.com/
```

### Interview Talking Points
- "CSP is defence in depth — you still sanitise input to prevent XSS, but CSP is the safety net. Even if an attacker injects a script tag, CSP prevents it from executing or exfiltrating data."
- "`upgrade-insecure-requests` is different from HSTS. HSTS is a browser-level commitment not to attempt HTTP for the domain. `upgrade-insecure-requests` upgrades embedded HTTP resources (images, fonts) to HTTPS inline."

---

## 10. Dependency Vulnerability Scanning

```bash
# Run audits
cd apps/backend && npm audit --audit-level=high
cd apps/frontend && npm audit --audit-level=high

# Fix non-breaking vulnerabilities
npm audit fix

# For acceptable risks, document why:
# Example: vuln in dev-only tooling, not in production bundle
```

### Add to GitHub Actions CI

```yaml
- name: Security Audit
  run: |
    cd apps/backend && npm audit --audit-level=high
    cd apps/frontend && npm audit --audit-level=high
```

### Interview Talking Points
- "I don't blindly run `npm audit fix` because it can introduce breaking changes. I review each advisory — attack vector, CVSS score, whether it affects my usage pattern — then decide."
- "For a RAG app, the highest-risk deps are `jsonwebtoken`, `bcryptjs`, `multer`, and anything in the HTTP parsing layer. I watch those especially closely."

---

## Quick Reference — Test All Features at Once

```bash
#!/bin/bash
BASE="http://localhost:5001"
TOKEN="your-jwt-here"

echo "=== Security Headers ==="
curl -sI $BASE/ | grep -iE "strict-transport|x-frame|x-content|referrer|permissions|content-security"

echo ""
echo "=== Zod Validation (expect 400) ==="
curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bad"}' | jq '.error, .fields[].message'

echo ""
echo "=== Rate Limiting (6th = 429) ==="
for i in {1..6}; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"WrongPass1!"}')
  echo "Attempt $i: HTTP $CODE"
done

echo ""
echo "=== Prototype Pollution Strip ==="
RESULT=$(curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"__proto__":{"hack":true},"name":"Eve","email":"ev@t.com","password":"SecurePass1!"}')
echo "$RESULT" | jq 'if .user then "user.__proto__.hack = \(.user.hack // "null (stripped!)")" else .error end'
```

---

## Files Modified / Created

| File | Action | Security Feature |
|------|--------|-----------------|
| `apps/backend/src/validation/schemas.ts` | **NEW** | Zod schemas + validate() middleware factory |
| `apps/backend/src/middleware/rateLimiter.ts` | **NEW** | Distributed Redis rate limiting |
| `apps/backend/src/middleware/sanitize.ts` | **NEW** | Body sanitisation + magic-byte file validation |
| `apps/backend/src/config/env.ts` | **UPGRADED** | Startup env validator + typed env object |
| `apps/backend/src/middleware/errorHandler.ts` | **UPGRADED** | Production error handler (ZodError, Prisma, JWT) |
| `apps/backend/src/index.ts` | **UPGRADED** | Hardened Helmet config, global rate limit, sanitize middleware |
| `apps/backend/src/routes/auth.ts` | **UPGRADED** | authLimiter + Zod validation |
| `apps/backend/src/routes/document.ts` | **UPGRADED** | uploadLimiter + magic-byte check + UUID param validation |
| `apps/backend/src/routes/query.ts` | **UPGRADED** | Redis queryLimiter (replaced in-memory), Zod validation |
| `apps/backend/src/controllers/auth.ts` | **UPGRADED** | next(err) pattern, timing-safe login |
| `apps/backend/src/controllers/query.ts` | **UPGRADED** | next(err) pattern, removed manual validation |
| `apps/backend/.env.example` | **UPGRADED** | Full annotated template (15 variables) |
| `apps/frontend/next.config.ts` | **UPGRADED** | 7 security headers via Next.js headers() |
| `SECURITY_CHECKLIST.md` | **NEW** | This document |
