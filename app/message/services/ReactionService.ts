/**
 * services/ReactionService.ts
 * Handles reaction operations for messages in the messaging system.
 */

import type { ReactionData, ReactionType } from '../models/Reaction';
import { Reaction } from '../models/Reaction';

export interface AddReactionRequest {
  messageId: number;
  userId: number;
  type: ReactionType;
}

export class ReactionService {
  /**
   * Manages reactions to messages.
   */
  private baseUrl: string;

  constructor(baseUrl: string = '/api/reactions') {
    this.baseUrl = baseUrl;
  }

  /**
   * Add a reaction to a message.
   */
  async addReaction(reactionData: AddReactionRequest): Promise<Reaction> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reactionData)
    });

    if (!response.ok) {
      throw new Error('Failed to add reaction');
    }

    const data: ReactionData = await response.json();
    return new Reaction(data);
  }

  /**
   * Remove a user's reaction from a message.
   */
  async removeReaction(messageId: number, userId: number): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${messageId}/user/${userId}`, {
      method: 'DELETE'
    });

    return response.ok;
  }

  /**
   * Get all reactions for a specific message.
   */
  async getReactions(messageId: number): Promise<Reaction[]> {
    const response = await fetch(`${this.baseUrl}/message/${messageId}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch reactions');
    }

    const data: ReactionData[] = await response.json();
    return data.map(reactionData => new Reaction(reactionData));
  }

  /**
   * Get reaction counts grouped by type for a message.
   */
  async getReactionCounts(messageId: number): Promise<Record<ReactionType, number>> {
    const reactions = await this.getReactions(messageId);
    const counts: Record<ReactionType, number> = {} as Record<ReactionType, number>;

    reactions.forEach(reaction => {
      counts[reaction.type] = (counts[reaction.type] || 0) + 1;
    });

    return counts;
  }

  /**
   * Toggle user's reaction on a message (like ↔ dislike)
   */
  async toggleReaction(messageId: number, userId: number, newType: ReactionType): Promise<Reaction> {
    // Remove existing reaction first, then add new one
    await this.removeReaction(messageId, userId);
    return await this.addReaction({ messageId, userId, type: newType });
  }
}
