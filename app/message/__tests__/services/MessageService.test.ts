/**
 * __tests__/services/MessageService.test.ts
 * Jest tests for the MessageService class
 */

import type { MessageData } from '../../models/Message';
import { Message } from '../../models/Message';
import type { CreateMessageRequest, MessageFilters } from '../../services/MessageService';
import { MessageService } from '../../services/MessageService';

// Mock global fetch
global.fetch = jest.fn();

describe('MessageService', () => {
  let messageService: MessageService;
  const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
  
  // Mock data for testing
  const mockMessageData: MessageData = {
    id: 1,
    author: 'testuser',
    content: 'Test message content',
    timestamp: '2024-01-01T00:00:00Z',
    reactions: []
  };

  const mockCreateRequest: CreateMessageRequest = {
    author: 'testuser',
    content: 'Test message content'
  };

  beforeEach(() => {
    messageService = new MessageService();
    mockedFetch.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============ createMessage() Tests ============
  describe('createMessage()', () => {
    it('should create message and return Message instance on success', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessageData
      } as Response);

      const result = await messageService.createMessage(mockCreateRequest);

      expect(mockedFetch).toHaveBeenCalledWith('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockCreateRequest)
      });
      expect(result).toBeInstanceOf(Message);
    });

    it('should throw error when create message fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 400
      } as Response);

      await expect(messageService.createMessage(mockCreateRequest))
        .rejects.toThrow('Failed to create message');
      
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ============ getMessages() Tests ============
  describe('getMessages()', () => {
    it('should fetch messages without filters and return Message array', async () => {
      const mockResponseData = [mockMessageData];
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponseData
      } as Response);

      const result = await messageService.getMessages();

      expect(mockedFetch).toHaveBeenCalledWith('http://localhost/api/messages');
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Message);
    });

    it('should append query parameters when filters are provided', async () => {
      const mockFilters: MessageFilters = {
        author: 'testuser',
        limit: 10
      };
      
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockMessageData]
      } as Response);

      await messageService.getMessages(mockFilters);

      const expectedUrl = expect.stringContaining('author=testuser');
      expect(mockedFetch).toHaveBeenCalledWith(expectedUrl);
    });

    it('should throw error when fetch messages fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response);

      await expect(messageService.getMessages())
        .rejects.toThrow('Failed to fetch messages');
    });
  });

  // ============ updateMessage() Tests ============
  describe('updateMessage()', () => {
    it('should update message and return Message instance on success', async () => {
      const updatedData = { ...mockMessageData, content: 'Updated content' };
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedData
      } as Response);

      const result = await messageService.updateMessage(1, 'Updated content');

      expect(mockedFetch).toHaveBeenCalledWith('/api/messages/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated content' })
      });
      expect(result).toBeInstanceOf(Message);
    });

    it('should throw error when update message fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      await expect(messageService.updateMessage(1, 'New content'))
        .rejects.toThrow('Failed to update message');
    });
  });

  // ============ deleteMessage() Tests ============
  describe('deleteMessage()', () => {
    it('should return true when message is successfully deleted', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true
      } as Response);

      const result = await messageService.deleteMessage(1);

      expect(mockedFetch).toHaveBeenCalledWith('/api/messages/1', {
        method: 'DELETE'
      });
      expect(result).toBe(true);
    });

    it('should return false when message deletion fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      const result = await messageService.deleteMessage(1);
      expect(result).toBe(false);
    });
  });
});
