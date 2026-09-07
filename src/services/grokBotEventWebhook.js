/**
 * Event notify to Grok Bot webhook (Cursor-hosted).
 * No-op when URL env is missing. Never throws to callers.
 * Returns a Promise so request handlers can await delivery before ending the response
 * (fire-and-forget fetch can be aborted when the App Service request completes).
 */

function getWebhookConfig() {
  const url = String(process.env.GROK_BOT_EVENT_WEBHOOK_URL || '').trim();
  const authorization = String(process.env.GROK_BOT_EVENT_WEBHOOK_AUTHORIZATION || '').trim();
  return { url, authorization };
}

/**
 * @param {{ type: string, userId?: number|null, email?: string|null, name?: string|null, at?: string|Date|null, meta?: object }} event
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, status?: number|null, error?: string|null }>}
 */
async function emitGrokBotEvent(event, options = {}) {
  try {
    const { url, authorization } = getWebhookConfig();
    if (!url) {
      return { ok: false, skipped: true, status: null, error: 'missing_url' };
    }

    const type = String(event?.type || '').trim();
    if (!type) {
      return { ok: false, skipped: true, status: null, error: 'missing_type' };
    }

    const atValue = event?.at ? new Date(event.at) : new Date();
    const payload = {
      type,
      userId: event?.userId == null || event?.userId === '' ? null : Number(event.userId),
      email: event?.email == null ? null : String(event.email),
      name: event?.name == null ? null : String(event.name),
      at: Number.isNaN(atValue.getTime()) ? new Date().toISOString() : atValue.toISOString(),
      meta: event?.meta && typeof event.meta === 'object' ? event.meta : {},
    };

    if (!Number.isFinite(payload.userId)) {
      payload.userId = null;
    }

    const headers = {
      'Content-Type': 'application/json',
    };
    if (authorization) {
      headers.Authorization = authorization;
    }

    const timeoutMs = Number(options.timeoutMs);
    const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 4000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error('[grokBotEventWebhook] emit non-2xx', response.status, type);
        return { ok: false, skipped: false, status: response.status, error: 'non_2xx' };
      }
      return { ok: true, skipped: false, status: response.status, error: null };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[grokBotEventWebhook] emit failed', err?.message || err);
    return { ok: false, skipped: false, status: null, error: String(err?.message || err) };
  }
}

module.exports = {
  emitGrokBotEvent,
};
