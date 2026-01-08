# Security Policy

## Reporting Security Issues

If you discover a security vulnerability, please **DO NOT** open a public issue. Instead:

1. Email: security@yourdomain.com (if applicable)
2. Or open a private security advisory on GitHub

We will respond within 48 hours and work with you to address the issue.

---

## Security Best Practices

### 🔒 Critical Security Configurations

#### 1. **GitHub Webhook Secret (CRITICAL)**

**Issue**: Webhooks without signature verification allow anyone to send fake events.

**Solution**:
```bash
# Generate strong secret
openssl rand -hex 32

# Add to backend/.env
GITHUB_WEBHOOK_SECRET=your-generated-secret-here

# Configure in GitHub webhook settings (must match exactly)
```

**Verification**: Check logs for "rejecting webhook" if secret is missing.

#### 2. **CORS Configuration**

**Issue**: Allowing all origins (`*`) enables cross-site attacks.

**Solution**:
```bash
# backend/.env
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Never use: ALLOWED_ORIGINS=*
```

#### 3. **Database Connection Security**

**Development**:
```bash
APP_DATABASE_URL=postgresql://user:pass@localhost:5432/db?sslmode=disable
```

**Production** (REQUIRED):
```bash
APP_DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

**Additional hardening**:
- Use strong passwords (20+ characters, random)
- Rotate credentials quarterly
- Use connection pooling with limits
- Enable SSL/TLS certificates

#### 4. **API Key Storage**

**✅ Correct**:
- API keys stored in database (encrypted)
- Managed via Settings UI
- Never committed to git

**❌ Incorrect**:
- Hardcoding API keys in code
- Storing in frontend environment variables
- Committing `.env` files with secrets

---

## Security Checklist

### Development Environment

- [ ] `.env` files in `.gitignore`
- [ ] No hardcoded secrets in code
- [ ] Database uses localhost only
- [ ] Webhook secret set (even for development)
- [ ] CORS allows `localhost:3000` only

### Production Environment

- [ ] Strong `GITHUB_WEBHOOK_SECRET` configured (32+ characters)
- [ ] `ALLOWED_ORIGINS` set to production domain(s) only
- [ ] Database SSL enabled (`sslmode=require`)
- [ ] Database uses strong password (20+ characters)
- [ ] API keys configured via Settings UI (not environment)
- [ ] `WEBHOOK_URL` points to public HTTPS endpoint
- [ ] All endpoints served over HTTPS
- [ ] Regular security updates applied
- [ ] Database backups enabled
- [ ] Monitoring and logging enabled

---

## Known Security Considerations

### 1. API Endpoint Authentication

**Status**: ⚠️ No authentication currently implemented

**Current State**:
- All API endpoints are open to anyone with network access
- Suitable for single-user/internal deployments
- **Not suitable** for multi-tenant or public deployments

**Mitigation**:
- Deploy behind a firewall/VPN
- Use IP allowlisting
- Implement authentication layer (OAuth, JWT) if multi-user

**Future Enhancement**: Add user authentication system

### 2. Settings Endpoint Protection

**Status**: ✅ Settings endpoint is now protected with authentication

**Implementation**:
- HTTP Basic Auth required for `POST /api/settings`
- Admin credentials from `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars
- Constant-time comparison prevents timing attacks
- Rate limited to 10 requests/minute per IP (prevents brute force)

**Configuration**:
```bash
# backend/.env
ADMIN_USERNAME=admin  # Optional, defaults to "admin"
ADMIN_PASSWORD=your-secure-password-here  # REQUIRED
```

**Security Features**:
- ✅ Authentication required
- ✅ Rate limiting (10/minute)
- ✅ Constant-time credential comparison
- ✅ Automatic password clearing in UI on success

### 3. Rate Limiting

**Status**: ✅ Comprehensive rate limiting implemented

**Implementation**:
- Webhook endpoint: 100 requests/minute per IP
- Settings endpoint: 10 requests/minute per IP (brute force protection)
- AI analyze endpoint: 30 requests/minute per IP (cost control)
- Batch triage endpoint: 5 requests/minute per IP (very expensive operations)

**Technology**: slowapi (FastAPI rate limiting middleware)

**Features**:
- ✅ IP-based rate limiting
- ✅ Per-endpoint limits
- ✅ Automatic 429 responses when exceeded
- ✅ Payload size limits (1MB for webhooks)
- ✅ GitHub API rate limit checking

**Rate Limit Headers**:
Responses include standard rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Time when limit resets

### 4. Input Validation

**Status**: ✅ Partial validation implemented

**Current State**:
- GitHub URLs validated on backend
- Webhook payloads size-limited
- SQL injection prevented (using parameterized queries)

**Gaps**:
- No regex validation on frontend GitHub URLs
- Command injection possible if URL malformed (mitigated by subprocess escaping)

**Recommendation**: Add comprehensive input validation layer

---

## Security Features Implemented

### ✅ Settings Endpoint Authentication
- HTTP Basic Auth with admin credentials
- Constant-time credential comparison (prevents timing attacks)
- Admin password required via `ADMIN_PASSWORD` environment variable
- Username configurable via `ADMIN_USERNAME` (default: "admin")

### ✅ Rate Limiting
- IP-based rate limiting using slowapi
- Per-endpoint limits:
  - Webhooks: 100/minute
  - Settings: 10/minute (brute force protection)
  - AI Analysis: 30/minute (cost control)
  - Batch Triage: 5/minute (expensive operations)
- Automatic 429 Too Many Requests responses
- Standard rate limit headers included

### ✅ Webhook Signature Verification
- HMAC SHA-256 validation
- Rejects all webhooks if secret not configured
- Constant-time signature comparison (prevents timing attacks)

### ✅ Request Size Limits
- 1MB maximum webhook payload
- Prevents DoS attacks via large payloads

### ✅ Encrypted API Key Storage
- API keys encrypted with Fernet (symmetric encryption)
- Keys never exposed to frontend
- Stored in database `settings` table

### ✅ Database Connection Management
- Context managers for automatic cleanup
- Prevents connection pool exhaustion
- Proper error handling

### ✅ CORS Protection
- Environment-based allowed origins
- Credentials allowed only for configured domains
- Development origins auto-added in dev mode

### ✅ SQL Injection Prevention
- All queries use parameterized statements
- No string concatenation for SQL
- Psycopg3's built-in protection

---

## Security Audit Log

### Critical Issues Fixed (2026-01-06)

1. **Webhook Signature Bypass** (CRITICAL)
   - **Before**: Empty webhook secret allowed all webhooks
   - **After**: Rejects all webhooks if secret not configured
   - **File**: `backend/api/webhooks.py:34`

2. **Database Connection Leaks** (HIGH)
   - **Before**: Connections not closed on exceptions
   - **After**: Context managers ensure cleanup
   - **File**: `backend/utils/database.py:15-34`

3. **Request Size Limit** (MEDIUM)
   - **Before**: No limit on webhook payloads
   - **After**: 1MB maximum payload size
   - **File**: `backend/api/webhooks.py:296-301`

### Critical Issues Fixed (2026-01-07)

4. **Settings Endpoint Protection** (CRITICAL)
   - **Before**: Anyone could change API keys without authentication
   - **After**: HTTP Basic Auth required with admin credentials
   - **Files**:
     - `backend/utils/security.py` (authentication module)
     - `backend/api/settings.py` (endpoint protection)
     - `frontend/components/SettingsModal.tsx` (UI with password input)

5. **Rate Limiting** (HIGH)
   - **Before**: No rate limiting on any endpoints
   - **After**: Comprehensive rate limiting on all sensitive endpoints
   - **Files**:
     - `backend/main.py` (slowapi integration)
     - `backend/api/webhooks.py` (100/minute)
     - `backend/api/settings.py` (10/minute)
     - `backend/api/triage.py` (30/minute for analyze, 5/minute for batch)

### Remaining Known Issues

See [Bug Analysis Report](docs/BUG_ANALYSIS_2026-01-06.md) for complete list:
- 5 Critical issues (0 remaining - all fixed!)
  - ✅ Webhook signature bypass (fixed 2026-01-06)
  - ✅ Database connection leaks (fixed 2026-01-06)
  - ✅ Request size limit (fixed 2026-01-06)
  - ✅ Settings endpoint protection (fixed 2026-01-07)
  - ✅ Rate limiting (fixed 2026-01-07)
- 5 High priority issues (1 remaining)
  - ✅ Rate limiting implemented (fixed 2026-01-07)
  - ⚠️ GitHub API exponential backoff (pending)
  - ⚠️ Race condition in repo indexing (pending)
- 17 Medium priority issues (15 remaining)
- 5 Low priority issues (5 remaining)

---

## Security Update Process

### Monthly Reviews
- Review dependency updates: `pip list --outdated`
- Check for security advisories: `pip-audit`
- Update Python packages: `pip install -U -r requirements.txt`
- Update Node packages: `npm audit fix`

### Quarterly Tasks
- Rotate database credentials
- Review access logs for anomalies
- Test webhook delivery
- Verify SSL certificate expiration dates

### Annual Tasks
- Full security audit
- Penetration testing (if applicable)
- Review and update this document
- Update encryption keys

---

## Contact

**Security Issues**: security@yourdomain.com (if applicable)
**General Questions**: Open an issue on GitHub
**Critical Vulnerabilities**: Report privately via GitHub Security Advisories

---

## Compliance

This project is designed for:
- ✅ Single-user deployments
- ✅ Internal team use
- ✅ Educational/research purposes

**Not suitable for** (without additional security):
- ❌ Multi-tenant SaaS
- ❌ Public-facing deployments
- ❌ Handling sensitive user data
- ❌ Compliance requirements (HIPAA, SOC2, etc.)

---

**Last Updated**: 2026-01-06
**Security Version**: 1.1
**Review Frequency**: Quarterly
