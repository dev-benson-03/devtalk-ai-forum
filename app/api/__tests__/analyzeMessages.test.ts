process.env.OPENAI_API_KEY = 'test-key';

global.Response = {
  json: (data: any, init?: any) => ({
    status: init?.status ?? 200,
    async json() { return data; }
  }),
} as any;

const mockCreate = jest.fn(async () => ({
  choices: [{ message: { content: '{"summary":"Test summary","actionRoadmap":["Step 1","Step 2","Step 3"]}' } }]
}));
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: class {
      chat = { completions: { create: mockCreate } };
    }
  };
});
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(() => ({ exists: () => false })),
  updateDoc: jest.fn(),
  getFirestore: jest.fn(() => ({})),
}));

const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE';

const validBody = {
  forumId: 'forum1',
  forumTitle: 'Test Forum',
  messages: [{ id: 1, author: 'A', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' }]
};

// Minimal Request stand-in: the route reads method, headers and text()
const mockRawRequest = (text: string, method = 'POST', headers: Record<string, string> = {}) => ({
  method,
  headers: new Headers(headers),
  text: async () => text,
});
const mockRequest = (body: unknown, method = 'POST', headers: Record<string, string> = {}) =>
  mockRawRequest(JSON.stringify(body), method, headers);

const loadAction = () => require('../analyzeMessages').action;

describe('analyzeMessages action', () => {
  let logs: jest.SpyInstance[];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    logs = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {})
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns 405 for non-POST requests', async () => {
    const res: any = await loadAction()({ request: mockRequest({}, 'GET') as any });
    expect(res.status).toBe(405);
  });

  it('returns 500 if OPENAI_API_KEY is missing', async () => {
    process.env.OPENAI_API_KEY = '';
    const res: any = await loadAction()({ request: mockRequest(validBody) as any });
    expect(res.status).toBe(500);
  });

  it('returns analysis response for valid input', async () => {
    const res: any = await loadAction()({ request: mockRequest(validBody) as any });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({
      totalMessages: 1,
      uniqueAuthors: 1,
      summary: 'Test summary',
      actionRoadmap: ['Step 1', 'Step 2', 'Step 3'],
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini', temperature: 0.3 }));
  });

  it('still accepts requests without an Authorization header (transitional, Phase 2A)', async () => {
    const res: any = await loadAction()({ request: mockRequest(validBody) as any });
    expect(res.status).toBe(200);
  });

  it('accepts a Bearer token without logging it', async () => {
    const request = mockRequest(validBody, 'POST', { Authorization: `Bearer ${SECRET_TOKEN}` });
    const res: any = await loadAction()({ request: request as any });
    expect(res.status).toBe(200);
    const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
    expect(logged).not.toContain('SECRET-PAYLOAD');
    expect(logged).not.toContain('Bearer');
  });

  it('returns cached analysis if cache exists', async () => {
    const cachedData = { summary: 'Cached summary', actionRoadmap: ['Cached Step'] };
    const getDoc = require('firebase/firestore').getDoc;
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => cachedData,
    });
    const res: any = await loadAction()({ request: mockRequest(validBody) as any });
    const data = await res.json();
    expect(data).toEqual(cachedData);
    getDoc.mockReset();
  });

  it('ignores a client-supplied user ID', async () => {
    const res: any = await loadAction()({ request: mockRequest({ ...validBody, uid: 'someone-else' }) as any });
    expect(res.status).toBe(200);
    expect(JSON.stringify(mockCreate.mock.calls)).not.toContain('someone-else');
  });

  it.each([
    ['invalid JSON', mockRawRequest('{"forumId":'), 400, 'invalid_json'],
    ['a missing forum ID', mockRequest({ ...validBody, forumId: undefined }), 400, 'invalid_forum_id'],
    ['an invalid forum ID', mockRequest({ ...validBody, forumId: 'forums/../x' }), 400, 'invalid_forum_id'],
    ['a non-array messages field', mockRequest({ ...validBody, messages: 'hi' }), 400, 'invalid_messages'],
    ['a malformed message', mockRequest({ ...validBody, messages: [{ id: 1, content: 42 }] }), 400, 'invalid_message'],
    ['an object smuggled as content', mockRequest({ ...validBody, messages: [{ id: 1, content: { $gt: '' } }] }), 400, 'invalid_message'],
    ['an oversized declared body', mockRawRequest('{}', 'POST', { 'Content-Length': '10000000' }), 413, 'body_too_large'],
  ])('rejects %s without calling OpenAI or Firestore', async (_label, request, status, reason) => {
    const { getDoc, updateDoc } = require('firebase/firestore');
    const res: any = await loadAction()({ request: request as any });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: status === 413 ? 'Request too large' : 'Invalid request',
      reason,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('does not expose exception details for invalid JSON', async () => {
    const res: any = await loadAction()({ request: mockRawRequest('{oops') as any });
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/SyntaxError|Unexpected token|position/);
  });
});
