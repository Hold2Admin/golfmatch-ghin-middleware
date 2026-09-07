/**
 * Fire-and-forget event notify to Grok Bot webhook (Cursor-hosted).
 * No-op when URL env is missing. Never throws to callers.
 */

function getWebhookConfig() {
  const url = String(process.env.GROK_BOT_EVENT_WEBHOOK_URL || '').trim();
  const authorization = String(process.env.GROK_BOT_EVENT_WEBHOOK_AUTHORIZATION || '').trim();
  return { url, authorization };
}

/**
 * @param {{ type: string, userId?: number|null, email?: string|null, name?: string|null, at?: string|Date|null, meta?: object }} event
 */
function emitGrokBotEvent(event) {
  try {
    const { url, authorization } = getWebhookConfig();
    if (!url) {
      return;
    }

    const type = String(event?.type || '').trim();
    if (!type) {
      return;
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

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.error('[grokBotEventWebhook] emit failed', err?.message || err);
    });
  } catch (err) {
    console.error('[grokBotEventWebhook] emit setup failed', err?.message || err);
  }
}

module.exports = {
  emitGrokBotEvent,
};
