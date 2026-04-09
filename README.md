# GHIN/WHS Middleware API

Middleware service for transforming and securing USGA GHIN/WHS API data for the Fore Play golf pairing application.

Current checkpoint: live GHIN course/player connectivity, cache DB writes, state-partition discovery/backfill, golfdb runtime-mirror callback sync, bulk CacheDB -> GolfDB runtime projection, webhook lifecycle validation, scheduled reconciliation, additive `ShortCourseName` hardening, full sandbox-accessible catalog projection into golfdb runtime, and the score-posting plus score-readback boundary are complete and validated. Staging webhook ingress and tokenized GPA callback registration are now proven, the real inbox-driven approval workflow is working end to end, and Golf Match runtime reads are already cut over to golfdb mirror tables. Further stage 1 CacheDB writer redesign remains deferred future scaling work rather than the current gate.

## Architecture

```
GolfMatch API ◄──► GHIN Middleware ◄──► GHIN/WHS API
(Fore Play)        (This Service)       (USGA)
```

## Purpose

- **Data Transformation**: Convert GHIN schema to Fore Play's domain model
- **Security Hardening**: API key auth, rate limiting, input validation
- **Caching**: Reduce GHIN API costs and improve response times
- **Audit Logging**: Track all API usage for compliance
- **Isolation**: Protect both systems from failures

## Quick Start

### Prerequisites

- Node.js 18+
- Azure SQL Database (for caching)
- Azure Cache for Redis
- Azure Key Vault access

### Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Update .env.local with your credentials

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

Server runs on `http://localhost:5001`

## Project Structure

```
src/
├── index.js              # Express app entry point
├── config/               # Configuration loaders
├── middleware/           # Express middleware (auth, rate limiting)
├── routes/               # API endpoints
│   ├── players.js
│   ├── courses.js
│   └── health.js
├── services/             # Business logic
│   ├── ghinClient.js     # GHIN API client (mock → real)
│   ├── cacheService.js   # Redis caching
│   └── transformers/     # Data transformation logic
├── db/                   # Database access
│   ├── migrations/       # SQL schema scripts
│   └── queries/          # SQL query builders
├── mocks/                # Mock GHIN API responses
└── utils/                # Shared utilities
```

## API Endpoints

**Base URL**: `https://golfmatch-ghin-middleware.azurewebsites.net/api/v1`

### Player Endpoints
- `GET /players/:ghinNumber` - Fetch player handicap
- `POST /players/batch` - Fetch multiple players
- `POST /players/search` - Search by name/club
- `POST /players/:ghinNumber/request-access` - Request golfer product access email
- `GET /players/:ghinNumber/access-status` - Read current golfer product access state
- `DELETE /players/:ghinNumber/revoke-access` - Revoke golfer product access
- `POST /players/:ghinNumber/approve-access` - Staging-only status update helper for deterministic admin tests; not the normal product approval path

### Course Endpoints
- `GET /courses/:ghinCourseId` - Fetch course data
- `POST /courses/search` - Search courses
- `POST /courses/import` - Import course to Fore Play

### Score Endpoints
- `POST /scores/post` - Normalized score-post boundary for GHIN submission
- `GET /scores/search` - Read official golfer scoring-record rows from GHIN
- `GET /scores/:scoreId` - Read official GHIN detail for a single posted score

Scoring-record note: GHIN score search/detail payloads do not provide a Par field. Middleware score-readback consumers should treat Par as course-runtime data, not as an official GHIN scoring-record field.

### Admin Endpoints
- `GET /health` - Health check
- `POST /sync/courses/:id` - Refresh course data

## Authentication

All endpoints require `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key-here" \
  https://localhost:5001/api/v1/players/1234567
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

## Deployment

Deployed via GitHub Actions to Azure App Service.

Pushes to `main` deploy automatically with a unique package blob and deployment version. The running deployment identity is exposed at `/api/v1/health` and `/` so you can verify which package actually booted.

See `.github/workflows/deploy-middleware.yml` for CI/CD pipeline.

## Environment Variables

See `.env.example` for full list of required environment variables.

Key settings:
- `APPLICATIONINSIGHTS_CONNECTION_STRING` (preferred) or `APPINSIGHTS_INSTRUMENTATIONKEY` for telemetry

Critical secrets stored in Azure Key Vault:
- Database passwords
- GHIN API credentials
- API keys
- Redis password

## Monitoring

- **Application Insights**: `golfmatch-insights` (set `APPLICATIONINSIGHTS_CONNECTION_STRING`)
- **Logs**: Azure App Service logs
- **Metrics**: Request rate, cache hit rate, error rate, latency

## Staging Notes

- Real GPA webhook delivery required opening third-party ingress to the middleware App Service; GHIN test and live webhook delivery are now validated.
- GHIN GPA registration must use the tokenized callback URL (`GHIN_GPA_WEBHOOK_URL` + `?token=` + `GHIN_GPA_WEBHOOK_TOKEN`). Registering the bare path causes middleware `400` rejects.
- The real product approval path is inbox-driven. The middleware still exposes status-update helpers for staging/admin testing, but Fore Play should not present that as the normal approval story.
- Do not assume staging course/tee catalogs match sandbox or previously mirrored data. Current staging evidence already shows tee-set ID and rating drift on real courses, so bulk staging import plus ongoing webhook/reconciliation sync should happen before trusting score posting broadly.

## Development Phases

- **Phase 1 / 1.5** (Validated): Live GHIN connectivity, separate cache DB, runtime mirror sync, webhook/reconciliation automation, additive course-name hardening
- **Phase 2** (Validated core flow): Golf Match runtime read-path cutover, state-partition catalog discovery/backfill, and CacheDB -> GolfDB bulk runtime projection
- **Phase 2 Remaining Work** (Deferred scaling): Replace stage 1 per-course CacheDB writes with a bulk CacheDB writer when national-scale catalog tuning becomes active work again
- **Phase 3**: Live handicap pulls and player caching
- **Phase 4+**: Expanded verification/reconciliation, golfer-state validation, and operational hardening on top of the now-validated score-posting and score-readback boundary

## Documentation

See `MIDDLEWARE-ARCHITECTURE.md` in this repo for the current middleware architecture and implementation status.

## License

MIT
