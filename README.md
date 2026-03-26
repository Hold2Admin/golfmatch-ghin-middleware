# GHIN/WHS Middleware API

Middleware service for transforming and securing USGA GHIN/WHS API data for the Fore Play golf pairing application.

Current checkpoint: live GHIN course/player connectivity, cache DB writes, golfdb runtime-mirror callback sync, webhook lifecycle validation, scheduled reconciliation, and additive `ShortCourseName` hardening are complete and validated. The next milestone is runtime read-path cutover verification in Golf Match.

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

### Course Endpoints
- `GET /courses/:ghinCourseId` - Fetch course data
- `POST /courses/search` - Search courses
- `POST /courses/import` - Import course to Fore Play

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

## Development Phases

- **Phase 1 / 1.5** (Current checkpoint): Live GHIN connectivity, separate cache DB, runtime mirror sync, webhook/reconciliation automation, additive course-name hardening
- **Phase 2**: Golf Match runtime read-path cutover and admin GHIN import UX
- **Phase 3**: Live handicap pulls and player caching
- **Phase 4+**: Expanded score-posting and operational hardening

## Documentation

See `MIDDLEWARE-ARCHITECTURE.md` in this repo for the current middleware architecture and implementation status.

## License

MIT
