import type { MessageAnalysisResponse } from './AnalysisService';
import { AnalysisService } from './AnalysisService';

describe('AnalysisService', () => {
  let service: AnalysisService;
  beforeEach(() => {
    service = new AnalysisService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('calls /api/analyzeMessages and returns parsed response', async () => {
    const mockResponse: MessageAnalysisResponse = {
      totalMessages: 2,
      uniqueAuthors: 1,
      summary: 'Test summary',
      actionRoadmap: ['Step 1', 'Step 2'],
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    const result = await service.analyzeMessages({
      forumId: 'f1',
      forumTitle: 'Forum',
      messages: [{ id: 1, author: 'A', content: 'msg', timestamp: '2025-01-01T00:00:00Z' }],
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/analyzeMessages', expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual(mockResponse);
  });

  it('throws if response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    await expect(service.analyzeMessages({
      forumId: 'f1',
      forumTitle: 'Forum',
      messages: [],
    })).rejects.toThrow('Failed to analyze messages');
  });
});
