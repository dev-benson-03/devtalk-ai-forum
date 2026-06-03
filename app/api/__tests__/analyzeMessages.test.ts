process.env.OPENAI_API_KEY = 'test-key';

global.Response = {
  json: (data: any, init?: any) => ({
    status: init?.status ?? 200,
    async json() { return data; }
  }),
} as any;

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: class {
      chat = {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '{"summary":"Test summary","actionRoadmap":["Step 1","Step 2","Step 3"]}' } }]
          }),
        },
      };
    }
  };
});
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(() => ({ exists: () => false })),
  updateDoc: jest.fn(),
    getFirestore: jest.fn(() => ({})), // Add this line

}));

const { action } = require('../analyzeMessages');

describe('analyzeMessages action', () => {
  const mockRequest = (body: any, method = 'POST') => ({
    method,
    json: async () => body,
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const req = mockRequest({}, 'GET');
    const res: any = await action({ request: req as any });
    expect(res.status).toBe(405);
  });

  it('returns 500 if OPENAI_API_KEY is missing', async () => {
    process.env.OPENAI_API_KEY = '';
    const req = mockRequest({});
    const res: any = await action({ request: req as any });
    expect(res.status).toBe(500);
  });

  it('returns analysis response for valid input', async () => {
    try {
      const req = mockRequest({
        forumId: 'forum1',
        forumTitle: 'Test Forum',
        messages: [{ id: 1, author: 'A', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' }]
      });
      const res: any = await action({ request: req as any });
      const data = await res.json();
      expect(data.summary).toBe('Test summary');
      expect(data.actionRoadmap).toEqual(['Step 1', 'Step 2', 'Step 3']);
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });

  it('returns cached analysis if cache exists', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const cachedData = { summary: 'Cached summary', actionRoadmap: ['Cached Step'] };
    const getDoc = require('firebase/firestore').getDoc;
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => cachedData,
    });
    const req = {
      method: 'POST',
      json: async () => ({
        forumId: 'forum1',
        forumTitle: 'Test Forum',
        messages: [{ id: 1, author: 'A', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' }]
      })
    };
    const { action } = require('../analyzeMessages');
    const res: any = await action({ request: req as any });
    const data = await res.json();
    expect(data).toEqual(cachedData);
  });
});
