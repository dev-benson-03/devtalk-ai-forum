/**
 * __tests__/services/ModerationService.test.ts
 * Jest tests for the ModerationService class
 */

import { ModerationService } from '../../services/ModerationService';
import type { ModerationResult } from '../../services/ModerationService';

// Mock global fetch
global.fetch = jest.fn();

describe('ModerationService', () => {
  let moderationService: ModerationService;
  const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
  
  // Mock data for testing
  const mockModerationResult: ModerationResult = {
    isApproved: true,
    flaggedWords: [],
    severity: 'low',
    suggestedAction: 'approve'
  };

  beforeEach(() => {
    moderationService = new ModerationService();
    mockedFetch.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============ checkContent() Tests ============
  describe('checkContent()', () => {
    it('should check content and return moderation result on success', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockModerationResult
      } as Response);

      const result = await moderationService.checkContent('Test message');

      expect(mockedFetch).toHaveBeenCalledWith('/api/moderation/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test message' })
      });
      expect(result).toEqual(mockModerationResult);
      expect(result.isApproved).toBe(true);
    });

    it('should throw error when content moderation check fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response);

      await expect(moderationService.checkContent('Test message'))
        .rejects.toThrow('Failed to check content moderation');
      
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ============ filterMessage() Tests ============
  describe('filterMessage()', () => {
    it('should return original message when no banned words', () => {
      const originalMessage = 'This is a clean message';
      
      const result = moderationService.filterMessage(originalMessage);
      
      expect(result).toBe(originalMessage);
    });

    it('should filter banned words when present', () => {
      // Mock banned words for testing
      (moderationService as any).bannedWords = ['bad', 'spam'];
      
      const result = moderationService.filterMessage('This is a bad spam message');
      
      expect(result).toBe('This is a *** **** message');
    });
  });

  // ============ loadBannedWords() Tests ============
  describe('loadBannedWords()', () => {
    it('should load banned words list from server on success', async () => {
      const mockBannedWords = ['spam', 'abuse', 'hate'];
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBannedWords
      } as Response);

      await moderationService.loadBannedWords();

      expect(mockedFetch).toHaveBeenCalledWith('/api/moderation/banned-words');
      expect((moderationService as any).bannedWords).toEqual(mockBannedWords);
    });

    it('should handle error gracefully when loading banned words fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      await moderationService.loadBannedWords();
      
      expect((moderationService as any).bannedWords).toEqual([]);
    });
  });

  // ============ quickValidation() Tests ============
  describe('quickValidation()', () => {
    it('should return true for valid content', () => {
      const result = moderationService.quickValidation('This is valid content');
      expect(result).toBe(true);
    });

    it('should return false for empty content', () => {
      expect(moderationService.quickValidation('')).toBe(false);
      expect(moderationService.quickValidation('   ')).toBe(false);
    });

    it('should return false for content exceeding length limit', () => {
      const longContent = 'a'.repeat(5001);
      const result = moderationService.quickValidation(longContent);
      expect(result).toBe(false);
    });

    it('should return true for content at length limit', () => {
      const maxContent = 'a'.repeat(5000);
      const result = moderationService.quickValidation(maxContent);
      expect(result).toBe(true);
    });
  });
});
