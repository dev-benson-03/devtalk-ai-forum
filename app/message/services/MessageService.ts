/**
 * services/MessageService.ts
 * Handles message-related API operations and business logic.
 */

import type { MessageData } from '../models/Message';
import { Message } from '../models/Message';

export interface CreateMessageRequest {
  author: string;
  content: string;
}

export interface MessageFilters {
  author?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export class MessageService {
  /**
   * Handles all message-related operations and API calls.
   */
  private baseUrl: string;

  constructor(baseUrl: string = '/api/messages') {
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new message.
   */
  async createMessage(messageData: CreateMessageRequest): Promise<Message> {
    // Placeholder for API call
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messageData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to create message');
    }
    
    const data: MessageData = await response.json();
    return new Message(data);
  }

  /**
   * Retrieve messages with optional filtering.
   */
  async getMessages(filters?: MessageFilters): Promise<Message[]> {
    // Placeholder for API call with query parameters
    const url = new URL(this.baseUrl, window.location.origin);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }

    const data: MessageData[] = await response.json();
    return data.map(messageData => new Message(messageData));
  }

  /**
   * Update an existing message.
   */
  async updateMessage(messageId: number, content: string): Promise<Message> {
    // Placeholder for API call
    const response = await fetch(`${this.baseUrl}/${messageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      throw new Error('Failed to update message');
    }

    const data: MessageData = await response.json();
    return new Message(data);
  }

  /**
   * Delete a message.
   */
  async deleteMessage(messageId: number): Promise<boolean> {
    // Placeholder for API call
    const response = await fetch(`${this.baseUrl}/${messageId}`, {
      method: 'DELETE'
    });

    return response.ok;
  }
}
