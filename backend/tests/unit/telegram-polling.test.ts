import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { processTelegramUpdate } from '../../src/modules/notifications/telegram-link.service.js';
import { startTelegramPolling } from '../../src/modules/notifications/telegram-polling.js';

vi.mock('../../src/modules/notifications/telegram-link.service.js', () => ({
  processTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

const originalMode = env.TELEGRAM_MODE;
const originalToken = env.TELEGRAM_BOT_TOKEN;
let handle: ReturnType<typeof startTelegramPolling>;

function pendingRequest(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

describe('Telegram polling lifecycle', () => {
  beforeEach(() => {
    env.TELEGRAM_MODE = 'polling';
    env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.mocked(processTelegramUpdate).mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
    env.TELEGRAM_MODE = originalMode;
    env.TELEGRAM_BOT_TOKEN = originalToken;
    vi.unstubAllGlobals();
  });

  it.each(['off', 'webhook'] as const)('does not poll in %s mode', (mode) => {
    env.TELEGRAM_MODE = mode;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    handle = startTelegramPolling();
    expect(handle).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not poll without a bot token', () => {
    env.TELEGRAM_BOT_TOKEN = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    handle = startTelegramPolling();
    expect(handle).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processes private updates and advances offset, skipping group chats', async () => {
    const update = {
      update_id: 41,
      message: { text: '/start one-time-code', chat: { id: 123, type: 'private' } },
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(pendingRequest);
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: [
          update,
          { update_id: 42, message: { text: '/start code', chat: { id: -10, type: 'group' } } },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    handle = startTelegramPolling();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(processTelegramUpdate).toHaveBeenCalledExactlyOnceWith(update);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        offset: 43,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }),
    );
    await handle?.stop();
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });

  it('retries failed processing without acknowledging the update', async () => {
    const update = { update_id: 7, message: { text: '/stop', chat: { id: 123, type: 'private' } } };
    vi.mocked(processTelegramUpdate).mockRejectedValueOnce(new Error('database unavailable'));
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(pendingRequest);
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: [update] }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: [update] }));
    vi.stubGlobal('fetch', fetchMock);
    handle = startTelegramPolling();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 7000 });
    expect(processTelegramUpdate).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        offset: 0,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }),
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        offset: 8,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }),
    );
  });

  it('backs off on API errors and allows immediate shutdown during backoff', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    handle = startTelegramPolling();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await handle?.stop();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(processTelegramUpdate).not.toHaveBeenCalled();
  });
});
