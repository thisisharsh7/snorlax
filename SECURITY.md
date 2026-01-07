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

**Status**: ⚠️ Settings endpoint is not authenticated

**Current State**:
- `POST /api/settings` allows anyone to change API keys
- Critical for single-user deployments

**Mitigation**:
- Deploy in trusted network only
- Add authentication middleware
- Use environment variables instead (less flexible)

**Recommendation**: Add authentication before multi-user deployment

### 3. Rate Limiting

**Status**: ⚠️ Limited rate limiting implemented

**Current State**:
- Webhook endpoint has payload size limits (1MB)
- No request-per-second limits
- GitHub API rate limit checking exists

**Mitigation**:
- Deploy behind reverse proxy with rate limiting (nginx, Cloudflare)
- Monitor webhook delivery logs
- Set up alerts for unusual traffic

**Future Enhancement**: Add FastAPI rate limiting middleware

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

### Remaining Known Issues

See [Bug Analysis Report](#bug-analysis-summary) for complete list:
- 5 Critical issues (0 remaining after fixes)
- 5 High priority issues (2 remaining)
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
