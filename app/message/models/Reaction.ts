/**
 * models/Reaction.ts
 * Defines the Reaction data model for message reactions.
 */

export interface ReactionData {
  id: number;
  userId: number;
  messageId: number;
  type: ReactionType;
  timestamp: string;
}

export enum ReactionType {
  LIKE = 'like',
  DISLIKE = 'dislike'
}

export class Reaction {
  /**
   * Represents a user's reaction to a message.
   */
  public id: number;
  public userId: number;
  public messageId: number;
  public type: ReactionType;
  public timestamp: string;

  constructor(data: ReactionData) {
    this.id = data.id;
    this.userId = data.userId;
    this.messageId = data.messageId;
    this.type = data.type;
    this.timestamp = data.timestamp;
  }

  /**
   * Return a plain object representation of the reaction.
   */
  toObject(): ReactionData {
    return {
      id: this.id,
      userId: this.userId,
      messageId: this.messageId,
      type: this.type,
      timestamp: this.timestamp
    };
  }

  /**
   * Check if the reaction is valid.
   */
  isValid(): boolean {
    return Object.values(ReactionType).includes(this.type);
  }

  /**
   * Get emoji representation of the reaction
   */
  getEmoji(): string {
    const emojiMap: Record<ReactionType, string> = {
      [ReactionType.LIKE]: '👍',
      [ReactionType.DISLIKE]: '👎'
    };
    return emojiMap[this.type] || '👍';
  }

  /**
   * Check if the reaction type is valid (only like/dislike allowed)
   */
  isValidType(): boolean {
    return ['like', 'dislike'].includes(this.type);
  }

  /**
   * Toggle reaction type for a user (like ↔ dislike)
   */
  static toggleReaction(userId: number, currentType: ReactionType): ReactionType {
    return currentType === ReactionType.LIKE ? ReactionType.DISLIKE : ReactionType.LIKE;
  }
}
