import type { User } from 'firebase/auth';
import type { MessageAnalysisResponse } from './AnalysisService';
import { AnalysisAuthError, AnalysisService } from './AnalysisService';

const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE';
const FRESH_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.FRESH-PAYLOAD.FRESH-SIGNATURE';

const payload = { forumId: 'f1' };

const mockResponse: MessageAnalysisResponse = {
  totalMessages: 2,
  uniqueAuthors: 1,
  summary: 'Test summary',
  actionRoadmap: ['Step 1', 'Step 2'],
};

const fakeUser = (getIdToken: jest.Mock) => ({ getIdToken }) as unknown as User;
const serviceFor = (user: User | null) => new AnalysisService(async () => user);
const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const authHeaderOf = (call: number) =>
  (global.fetch as jest.Mock).mock.calls[call][1].headers.Authorization;

describe('AnalysisService', () => {
  let getIdToken: jest.Mock;
  let logs: jest.SpyInstance[];

  beforeEach(() => {
    global.fetch = jest.fn();
    getIdToken = jest.fn(async (force?: boolean) => (force ? FRESH_TOKEN : SECRET_TOKEN));
    logs = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {})
    );
  });

  afterEach(() => {
    const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
    expect(logged).not.toContain('SECRET-PAYLOAD');
    expect(logged).not.toContain('FRESH-PAYLOAD');
    jest.restoreAllMocks();
  });

  it('sends the payload with a Bearer ID token and returns the response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, mockResponse));
    const result = await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload);

    expect(global.fetch).toHaveBeenCalledWith('/api/analyzeMessages', expect.objectContaining({ method: 'POST' }));
    expect(authHeaderOf(0)).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(payload);
    expect(getIdToken).toHaveBeenCalledWith(false);
    expect(result).toEqual(mockResponse);
  });

  it('never puts a user ID in the request body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, mockResponse));
    await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('uid');
    expect(body).not.toHaveProperty('userId');
  });

  it('throws signed_out without calling the API when nobody is signed in', async () => {
    await expect(serviceFor(null).analyzeMessages(payload)).rejects.toEqual(
      new AnalysisAuthError('signed_out')
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws token_unavailable when getIdToken fails, without leaking the cause', async () => {
    getIdToken.mockRejectedValue(new Error(`network failure near ${SECRET_TOKEN}`));
    const error = await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload).catch((e) => e);
    expect(error).toBeInstanceOf(AnalysisAuthError);
    expect(error.reason).toBe('token_unavailable');
    expect(error.message).not.toContain('SECRET');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries a 401 once with a force-refreshed token', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200, mockResponse));
    const result = await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenLastCalledWith(true);
    expect(authHeaderOf(1)).toBe(`Bearer ${FRESH_TOKEN}`);
    expect(result).toEqual(mockResponse);
  });

  it('throws unauthorized when the retry also gets 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(401));
    const error = await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload).catch((e) => e);
    expect(error).toEqual(new AnalysisAuthError('unauthorized'));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing error for other failed responses, with the status only', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(503, { error: 'Service unavailable' }));
    const error = await serviceFor(fakeUser(getIdToken)).analyzeMessages(payload).catch((e) => e);
    expect(error.message).toBe('Failed to analyze messages');
    expect(error.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends only the forum ID and optional forceRegenerate flag', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, mockResponse));
    await serviceFor(fakeUser(getIdToken)).analyzeMessages({ forumId: 'f1', forceRegenerate: true });
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
      forumId: 'f1',
      forceRegenerate: true,
    });
  });

  it('error messages never contain a token', () => {
    for (const reason of ['signed_out', 'token_unavailable', 'unauthorized'] as const) {
      expect(new AnalysisAuthError(reason).message).not.toMatch(/eyJ/);
    }
  });
});
