# GHIN Middleware API - Product Roadmap

**Last Updated**: December 24, 2025  
**Status**: Phase 1 (Core Infrastructure) - In Progress  
**Governance**: Team-maintained; update as decisions/priorities change

---

## Table of Contents

1. [Completed Phases](#completed-phases)
2. [Current Phase](#current-phase)
3. [Future Enhancements](#future-enhancements)
4. [Deferred/On-Hold](#deferredon-hold)
5. [Decision Log](#decision-log)

---

## Completed Phases

### Phase 1: Core Middleware (December 2025)
**Status**: ✅ In Progress

**Scope:**
- Basic Express API (players, courses, health endpoints)
- Mock GHIN data for development
- Data transformers (handicap parsing, course normalization)
- Local development setup
- Security headers (helmet, CORS)

**Infrastructure:**
- ✅ App Service deployment (shared plan with golfmatch-api)
- ✅ SQL Database (golfdb-ghin-cache created)
- ✅ VNet integration (subnet-appservice)
- ✅ Managed identity (oidc-msi-b356)

**Decisions Made:**
- Use existing `golfdb-ghin-cache` (cost optimization)
- API Key authentication (server-to-server, no OAuth2 yet)
- Direct App Service (no APIM)
- API Key (not JWT)
- Application Insights for observability
- Direct production deploys (no staging slot yet)

---

## Current Phase

### Phase 2: Production Hardening (December 2025 - January 2026)
**Status**: ⏳ Starting

**Scope:**
1. **Infrastructure & Security**
   - [ ] Create Redis cache (Basic C0, VNet integration)
   - [ ] Create Application Insights instance
   - [ ] Configure managed identity RBAC (Key Vault, SQL, Redis)
   - [ ] Add secrets to Key Vault (Redis connection string, API key, DB password)
   - [ ] Enable HTTPS-only on App Service
   - [ ] Configure IP whitelist (golfmatch-api outbound IPs → middleware)
   - [ ] Lock down SQL public network access

2. **Code: Security & Auth**
   - [ ] Add Key Vault SDK with managed identity authentication
   - [ ] Implement API Key validation middleware
   - [ ] Add request signature validation (optional: HMAC-SHA256)
   - [ ] Add input validation/sanitization (express-validator improvements)
   - [ ] Lock down CORS to golfmatch-api origin only

3. **Code: Reliability**
   - [ ] Add Redis client with connection pooling + retry logic
   - [ ] Implement caching layer (players, courses, searches)
   - [ ] Add cache TTL enforcement (per config)
   - [ ] Add circuit breaker pattern for GHIN API calls
   - [ ] Implement comprehensive health checks:
     - Database connectivity + query timeout
     - Redis connectivity + latency
     - GHIN API mock/live reachability
     - Managed identity token freshness

4. **Code: Observability**
   - [ ] Wire Application Insights SDK
   - [ ] Add correlation ID tracking (all requests)
   - [ ] Structured logging → App Insights (not just local files)
   - [ ] Add request/dependency telemetry
   - [ ] Add custom metrics (cache hit rate, API latency)
   - [ ] Set up alerting rules (high error rate, slow endpoints)

5. **Code: Performance & Throttling**
   - [ ] Implement Redis-backed rate limiting per API key
   - [ ] Add request timeout enforcement
   - [ ] Implement response compression (gzip)
   - [ ] Add ETag/conditional request support
   - [ ] Optimize transformer functions (benchmarking)

6. **Testing & Validation**
   - [ ] Unit tests (transformers, middleware)
   - [ ] Integration tests (database, Redis, GHIN client)
   - [ ] End-to-end tests (health, player fetch, course fetch)
   - [ ] Security tests (auth validation, injection tests)
   - [ ] Load test (concurrent requests, cache behavior)

7. **Deployment Pipeline**
   - [ ] Create GitHub Actions workflow (build, test, deploy)
   - [ ] Configure OIDC for GitHub → Azure authentication
   - [ ] Add pre-deployment validation steps
   - [ ] Configure GitHub secrets for GHIN API key
   - [ ] Test deployment to staging → production

**Expected Completion**: End of January 2026

---

## Future Enhancements

### E1: Deployment Slots & Zero-Downtime Deploys
**Trigger**: When going live with paying customers  
**Priority**: High (must have for production)  
**Effort**: Low (2-3 hours)  
**Cost**: Minimal (staging slot ~$15/mo)

**Description:**
Currently deploying directly to production. When customer-facing, implement staging slot for safe testing before prod.

**Implementation Details:**
- [ ] Create App Service staging slot
- [ ] Configure staging slot with identical app settings
- [ ] Update GitHub Actions to deploy to staging
- [ ] Add pre-swap health checks
- [ ] Add automated slot swap on success
- [ ] Document rollback procedure
- [ ] Configure traffic split (optional: canary deployments)

**Testing:**
- Deploy to staging, verify all endpoints
- Test slot swap mechanics
- Test rollback procedure
- Measure swap duration

**Documentation:**
- Update deployment guide in README
- Document staging environment URL
- Document manual rollback steps

---

### E2: Database Tier Upgrade
**Trigger**: Performance degradation or throughput limits hit  
**Priority**: Medium (monitor metrics first)  
**Effort**: Very Low (1 hour, non-breaking)  
**Cost**: ~$20-50/mo (General Purpose tier)

**Current State:**
- `golfdb-ghin-cache`: Basic tier (5 DTU)
- Sufficient for caching, ~100 concurrent connections

**Upgrade Thresholds:**
- DTU utilization > 80% sustained
- Query latency > 500ms on cache reads
- Cache misses spiking due to eviction
- > 10k concurrent requests/min

**Upgrade Path:**
- [ ] Monitor DTU metrics in Azure Portal
- [ ] If threshold hit, scale to General Purpose (S1 or S2)
- [ ] Run smoke tests post-upgrade
- [ ] Update documentation

**Monitoring Setup (Phase 2):**
- Set Alert: DTU avg > 70% over 5 min
- Set Alert: Connection count > 80% max
- Dashboard: DTU trend, query duration percentiles

---

### E3: Azure APIM (API Management) Gateway
**Trigger**: Need for centralized API versioning, throttling dashboard, or 3rd-party integrations  
**Priority**: Medium (not needed for single internal caller)  
**Effort**: Medium (4-8 hours setup + $50+/mo cost)  
**Cost**: $50/mo minimum (Consumption tier: ~$0.30/call after free tier)

**Current State:**
- Direct App Service access (no gateway)
- Rate limiting handled in-app (Redis)
- No centralized API versioning

**When to Implement:**
- Add mobile app that calls middleware directly
- Need to expose API to 3rd-party golf course networks
- Require API versioning (v1, v2, v3 policies)
- Need analytics/quota dashboard for external partners
- Implement API marketplace/monetization

**Implementation Details:**
- [ ] Create APIM instance (Consumption tier to start)
- [ ] Migrate rate-limiting policies to APIM
- [ ] Add product tiers (free/premium/enterprise)
- [ ] Implement API versioning policies
- [ ] Add request/response transformation rules
- [ ] Set up developer portal
- [ ] Configure monitoring/alerting in APIM
- [ ] Update GitHub Actions to deploy API definitions
- [ ] Migrate DNS to APIM endpoint

**Architecture Change:**
```
golfmatch-api → APIM → App Service (middleware)
                ↓
         Unified throttling, versioning, analytics
```

**Testing:**
- Backward compatibility: old direct calls still work
- Policy validation: rate limiting, versioning
- Performance: latency impact of APIM hop

**Documentation:**
- APIM endpoints in docs
- API versioning strategy
- Developer portal setup
- Partner onboarding guide

---

### E4: OAuth2/JWT Authentication (Token Endpoint)
**Trigger**: Multiple callers (mobile app, web app, 3rd-party) or per-user audit trail requirements  
**Priority**: Medium (not urgent for server-to-server)  
**Effort**: Medium (1-2 days implementation + testing)  
**Cost**: Minimal (no new infrastructure, just code)

**Current State:**
- API Key authentication (shared secret in Key Vault)
- Single caller: golfmatch-api only

**When to Implement:**
- Build mobile app that calls middleware
- Expose API to external partners
- Need per-user/per-app audit trails (claims in token)
- Implement delegated access (scopes: player.read, course.write)
- Token expiration/refresh requirements

**Implementation Details:**

**Option 1: Token endpoint in golfmatch-api (Recommended)**
```csharp
POST /api/auth/ghin-token
Body: { clientId: "golfmatch-middleware", clientSecret: "..." }
Response: { access_token: "eyJ...", expires_in: 3600, token_type: "Bearer" }
```
- golfmatch-api issues tokens (it knows middleware secret)
- Middleware validates JWT signature (public key in Key Vault)
- Pros: Token endpoint separated from GHIN API
- Cons: Adds auth logic to main app

**Option 2: Token endpoint in middleware**
```javascript
POST /api/v1/auth/token
Body: { clientId: "golfmatch-api", clientSecret: "..." }
Response: { access_token: "eyJ...", expires_in: 3600 }
```
- Middleware issues its own tokens
- Pros: Self-contained
- Cons: Chicken-egg problem (if middleware down, no tokens)

**Implementation Steps:**
- [ ] Choose token endpoint location
- [ ] Generate RSA key pair (private in Key Vault, public in middleware)
- [ ] Implement JWT signing/validation
- [ ] Add token refresh endpoint (optional)
- [ ] Update middleware to validate JWT (not API key)
- [ ] Add clock skew tolerance (±5 sec)
- [ ] Implement token revocation list (optional)
- [ ] Add claims validation (issuer, audience, expiration)
- [ ] Update health check (token endpoint reachability)
- [ ] Update rate limiting (per client_id, not API key)

**Token Claims Schema:**
```json
{
  "iss": "https://golfmatch-api.azurewebsites.net",
  "aud": "golfmatch-ghin-middleware",
  "sub": "golfmatch-api",
  "client_id": "golfmatch-api",
  "scope": "player.read course.read",
  "iat": 1703436000,
  "exp": 1703439600
}
```

**Testing:**
- Token generation works
- Token validation (valid, expired, invalid signature)
- Clock skew handling
- Token refresh (if implemented)
- Revocation list (if implemented)

**Migration Path:**
- Deploy token endpoint (backward compatible)
- Accept both API Key and JWT during transition period
- Update golfmatch-api to use JWT
- Deprecate API Key (6-month notice)
- Remove API Key support

**Documentation:**
- OAuth2 flow diagrams
- JWT claims reference
- Token endpoint specification
- Client library integration (e.g., for future mobile apps)

---

### E5: GHIN Live API Integration
**Trigger**: When GHIN API credentials are obtained  
**Priority**: Critical (core feature)  
**Effort**: High (3-5 days, depends on GHIN API complexity)  
**Cost**: GHIN API subscription cost (unknown)

**Current State:**
- Mock GHIN data (hardcoded in ghinData.js)
- Config flag: `config.ghin.useMock`
- Service: ghinClient.js returns mock responses

**When to Implement:**
- GHIN API credentials received (API key + account setup)
- GHIN API documentation provided
- Rate limits known (max RPS, daily quota)
- Data schema validated against mock data

**Implementation Details:**
- [ ] Parse GHIN API documentation
- [ ] Update ghinClient.js with real API calls
- [ ] Implement request signing (if required)
- [ ] Add retry logic with exponential backoff
- [ ] Implement rate limiting per config
- [ ] Add GHIN API error handling (map to standard errors)
- [ ] Implement circuit breaker (fail fast if GHIN down)
- [ ] Add logging for all GHIN calls (audit trail)
- [ ] Update health check (GHIN API latency)
- [ ] Cache responses (use existing caching layer)
- [ ] Add GHIN API timeout handling

**Code Changes (Minimal):**
```javascript
// ghinClient.js - minimal changes
async function getPlayer(ghinNumber) {
  if (config.ghin.useMock) {
    return mockData.getPlayer(ghinNumber); // unchanged
  }
  
  // NEW: Real GHIN API call
  const response = await fetch(`${config.ghin.baseUrl}/players/${ghinNumber}`, {
    headers: {
      'Authorization': `Bearer ${config.ghin.apiKey}`,
      'User-Agent': 'golfmatch-ghin-middleware/1.0'
    },
    timeout: config.ghin.timeout
  });
  
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GHIN API: ${response.status}`);
  
  return response.json();
}
```

**Fallback Strategy:**
- On GHIN API error: return cached data if available
- If no cache: return 503 with retry-after header
- Log all failures for debugging

**Testing:**
- Unit tests with GHIN API mocked
- Integration tests with sandbox GHIN account
- Load testing (ensure rate limits respected)
- Failover testing (GHIN down → use cache)
- Data transformation validation (mock vs real)

**Monitoring:**
- GHIN API latency (p50, p95, p99)
- GHIN API error rate
- Cache hit rate before/after
- Rate limit utilization

**Rollback Plan:**
- Set `GHIN_API_KEY` to empty string → switch to mock
- Keep mock data up-to-date for fallback
- Document manual rollback steps

---

### E6: Advanced Caching Features
**Trigger**: Performance optimization or compliance requirements  
**Priority**: Low (Phase 2 covers basics)  
**Effort**: Low-Medium (2-3 days)  
**Cost**: Minimal

**Current State:**
- Basic Redis-backed caching (cache layer not yet implemented in Phase 2)
- TTLs defined in config (24h players, 30d courses, 1h searches)

**Future Enhancements:**
- [ ] Implement cache warming (preload popular courses/players on startup)
- [ ] Add cache invalidation API (admin endpoint to force refresh)
- [ ] Implement cache versioning (detect GHIN schema changes)
- [ ] Add cache statistics dashboard (hit rate, size, evictions)
- [ ] Implement partial invalidation (by region, handicap range, etc.)
- [ ] Add backup cache (fallback Redis if primary down)
- [ ] Implement client-side caching headers (ETag, Cache-Control)
- [ ] Add cache compression (gzip for large datasets)
- [ ] Implement bloom filter for fast "not found" detection

**When to Add:**
- Cache hit rate drops below 70%
- Memory usage grows beyond Redis limits
- Need compliance audit of cached data
- Performance degradation due to cache misses

---

### E7: Advanced Monitoring & Analytics
**Trigger**: Need for deeper insights into usage patterns and performance  
**Priority**: Low (Phase 2 covers basic App Insights)  
**Effort**: Low-Medium (2-3 days)  
**Cost**: Minimal (built on App Insights)

**Current State:**
- Application Insights basic telemetry (Phase 2)
- Local file-based logging

**Future Enhancements:**
- [ ] Add custom business metrics (players fetched by handicap range, courses by region)
- [ ] Implement usage dashboard (requests by endpoint, by caller)
- [ ] Add performance SLA tracking (99th percentile latency targets)
- [ ] Implement cost tracking (per-request cost analysis)
- [ ] Add anomaly detection (unusual request patterns)
- [ ] Create executive dashboard (uptime, performance, cost)
- [ ] Implement automated alerts (error spikes, latency degradation)
- [ ] Add tracing for multi-hop calls (golfmatch-api → middleware → GHIN)

**Dashboard Examples:**
- Players endpoint: avg latency, hit rate, top handicap ranges
- Courses endpoint: geography distribution, popular courses
- Cache efficiency: Redis vs DB vs GHIN hits
- Error breakdown: by type, by caller, by time of day

---

### E8: Data Sync & Validation
**Trigger**: Data integrity concerns or need for audit trail  
**Priority**: Medium (important for compliance)  
**Effort**: Medium-High (3-5 days)  
**Cost**: Minimal

**Current State:**
- Middleware is stateless (just transforms data)
- No validation of GHIN data structure
- No audit log of data changes

**Future Enhancements:**
- [ ] Implement data validation schema (JSON Schema for GHIN responses)
- [ ] Add audit log table (who fetched what, when)
- [ ] Implement change detection (flag when GHIN data differs from cache)
- [ ] Add data integrity checks (handicap ranges, course ratings valid)
- [ ] Implement reconciliation job (nightly sync of sample players/courses)
- [ ] Add data quality metrics (completeness, accuracy)
- [ ] Implement rollback capability (restore cached data from X hours ago)
- [ ] Add compliance reporting (audit export for regulators)

**Audit Log Schema:**
```sql
CREATE TABLE AuditLog (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  apiKey NVARCHAR(255) NOT NULL,
  endpoint NVARCHAR(255) NOT NULL,
  resourceId NVARCHAR(255) NOT NULL,
  sourceSystem NVARCHAR(50) NOT NULL, -- CACHE, GHIN, MOCK
  httpStatus INT NOT NULL,
  duration_ms INT NOT NULL,
  cacheHit BIT NOT NULL,
  hashedRequestBody NVARCHAR(255) NULL,
  ipAddress NVARCHAR(50) NOT NULL
);
```

---

### E9: Webhook/Notification System
**Trigger**: When external systems need real-time updates (e.g., course changes)  
**Priority**: Low (not needed initially)  
**Effort**: Medium-High (4-5 days)  
**Cost**: Minimal

**Use Cases:**
- Notify golfmatch-api when course data changes
- Alert admins when GHIN API is unreachable
- Notify mobile app of handicap updates

**Implementation:**
- [ ] Add webhook registration endpoint
- [ ] Store webhooks in database with retry policy
- [ ] Implement async queue (Service Bus or local queue)
- [ ] Add webhook delivery with exponential backoff
- [ ] Add webhook signature validation (HMAC-SHA256)
- [ ] Implement webhook test/health checks
- [ ] Add webhook management portal

---

### E10: Database Migrations Framework
**Trigger**: When schema changes become frequent  
**Priority**: Low (basic schema in place)  
**Effort**: Low (1-2 days)  
**Cost**: Minimal

**Current State:**
- Manual SQL creation (if needed)
- No version tracking

**When to Add:**
- Need to track schema versions
- Multiple environments (dev, staging, prod)
- Frequent schema updates
- Compliance requirement for audit trail

**Implementation:**
- [ ] Choose migration tool (Flyway, Liquibase)
- [ ] Create migrations folder structure
- [ ] Document migration naming convention
- [ ] Add pre-deployment migration validation
- [ ] Add rollback capability
- [ ] Document migration process in GitHub Actions

---

### E11: Load Testing & Capacity Planning
**Trigger**: As usage scales or approaching production  
**Priority**: Medium-High (pre-production requirement)  
**Effort**: Medium (2-3 days)  
**Cost**: Minimal

**Current State:**
- No load testing yet
- Unknown max capacity

**Before Going Live:**
- [ ] Run load test (1000 concurrent users, 5 min duration)
- [ ] Identify bottleneck (cache, DB, API, network)
- [ ] Document max throughput (requests/sec)
- [ ] Document resource utilization (CPU, memory, connections)
- [ ] Create capacity planning guide
- [ ] Set auto-scale thresholds

**Tools:**
- Azure Load Testing (managed service)
- k6 (open source, scriptable)
- JMeter (if needed for complex scenarios)

---

## Deferred/On-Hold

### D1: GraphQL API Layer
**Status**: On Hold  
**Reason**: REST API sufficient for current use case; GraphQL adds complexity without benefit  
**Revisit When**: 
- Need for complex filtering/field selection
- Multiple client types with different data needs
- Performance issues with over-fetching

**Notes:**
- Adds query complexity
- Requires schema management
- Good for public APIs, overkill for internal service

---

### D2: Multi-Region Deployment
**Status**: On Hold  
**Reason**: Single region (westus2) sufficient; Azure handles HA within region  
**Revisit When**:
- Customers span multiple geographies
- Need sub-100ms response times globally
- GHIN API adds regional endpoints

**Notes:**
- Significant infrastructure complexity
- Requires data replication strategy
- Increases cost significantly

---

### D3: Mobile App Integration
**Status**: On Hold  
**Reason**: Mobile apps not in scope; golfmatch-web is web-based  
**Revisit When**:
- Mobile app planned (iOS/Android)
- Need requires token-based auth (not API key)

**Notes:**
- Triggers JWT implementation
- Adds mobile-specific endpoints
- Increases API support burden

---

## Decision Log

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2025-12-24 | Use existing golfdb-ghin-cache for caching | Cost optimization, already exists | ✅ Locked |
| 2025-12-24 | Create Redis Basic C0 cache | Professional-grade caching, low cost (~$16/mo) | ✅ Locked |
| 2025-12-24 | API Key authentication (not OAuth2/JWT) | Server-to-server, single caller, simplicity | ✅ Locked |
| 2025-12-24 | Direct App Service (not APIM) | Lower latency, sufficient for single caller | ✅ Locked |
| 2025-12-24 | Application Insights for observability | Professional-grade, essential for debugging | ✅ Locked |
| 2025-12-24 | Direct production deploys (no staging yet) | Cost optimization until live with customers | ✅ Locked |
| 2025-12-24 | Defer JWT/OAuth2 implementation | Not needed until multiple callers | ✅ Deferred |
| 2025-12-24 | Defer APIM implementation | Not needed until external integrations | ✅ Deferred |
| 2025-12-24 | Defer deployment slots | Implement when going live with customers | ✅ Deferred |

---

## Maintenance Notes

**How to Update This File:**
1. Add completed items to "Completed Phases"
2. Move in-progress items to "Current Phase"
3. Update "Current Phase" status regularly
4. Add new decisions to "Decision Log" with date + rationale
5. Move deferred items to "Deferred/On-Hold" with revisit triggers
6. Promote future enhancements when they become priorities

**Review Cadence:**
- Monthly: Update current phase progress
- Before releases: Review deferred items
- Quarterly: Reassess priorities based on usage patterns

---

**Last Review**: December 24, 2025 (Initial creation)  
**Next Review**: January 2026 (After Phase 2 completion)
