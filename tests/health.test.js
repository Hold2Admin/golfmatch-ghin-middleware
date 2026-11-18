// ============================================================
// Health Endpoint Integration Tests
// ============================================================

// src/index.js reads the CORS origin list when it loads, and fails without it; the test supplies its own.
process.env.MIDDLEWARE_ALLOWED_ORIGINS = 'http://localhost';

const request = require('supertest');
const app = require('../src/index');

describe('Health Endpoint', () => {
  describe('GET /api/v1/health', () => {
    it('should return 200 and health status', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('checks');
      expect(Array.isArray(response.body.checks)).toBe(true);
    });

    it('should include app check', async () => {
      const response = await request(app).get('/api/v1/health');

      const appCheck = response.body.checks.find((c) => c.name === 'app');
      expect(appCheck).toBeDefined();
      expect(appCheck.status).toBe('healthy');
    });

    it('should include Application Insights check', async () => {
      const response = await request(app).get('/api/v1/health');

      const aiCheck = response.body.checks.find((c) => c.name === 'appInsights');
      expect(aiCheck).toBeDefined();
    });

    it('should report environment correctly', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(['development', 'production', 'test']).toContain(
        response.body.environment
      );
    });

    it('should report GHIN API mode', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(['MOCK', 'LIVE']).toContain(response.body.ghinApiMode);
    });
  });
});
