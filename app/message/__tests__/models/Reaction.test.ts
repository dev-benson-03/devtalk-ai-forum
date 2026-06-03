/**
 * __tests__/models/Reaction.test.ts
 * Jest tests for the Reaction model
 */

import { Reaction, type ReactionData, ReactionType } from '../../models/Reaction';

describe('Reaction Model', () => {
  // Test data setup
  const mockReactionData: ReactionData = {
    id: 1,
    userId: 123,
    messageId: 456,
    type: ReactionType.LIKE,
    timestamp: '2024-01-01T00:00:00Z'
  };

  // Constructor initializes all fields correctly
  it('should initialize all fields correctly via constructor', () => {
    const reaction = new Reaction(mockReactionData);
    
    expect(reaction.id).toBe(1);
    expect(reaction.userId).toBe(123);
    expect(reaction.messageId).toBe(456);
    expect(reaction.type).toBe(ReactionType.LIKE);
    expect(reaction.timestamp).toBe('2024-01-01T00:00:00Z');
  });

  // toObject returns plain object matching ReactionData interface
  it('should return plain object via toObject method', () => {
    const reaction = new Reaction(mockReactionData);
    const result = reaction.toObject();
    
    expect(result).toEqual(mockReactionData);
    expect(typeof result).toBe('object');
    expect(result.constructor).toBe(Object);
  });

  // isValid checks if reaction type is valid
  it('should validate reaction type correctly', () => {
    const validReaction = new Reaction(mockReactionData);
    expect(validReaction.isValid()).toBe(true);
    
    const invalidReaction = new Reaction({ ...mockReactionData, type: 'invalid' as ReactionType });
    expect(invalidReaction.isValid()).toBe(false);
  });

  // getEmoji returns correct emoji for reaction type
  it('should return correct emoji for each reaction type', () => {
    const likeReaction = new Reaction({ ...mockReactionData, type: ReactionType.LIKE });
    expect(likeReaction.getEmoji()).toBe('👍');
  });

  // Edge case: getEmoji fallback for invalid type
  it('should return default emoji for invalid reaction type', () => {
    const invalidReaction = new Reaction({ ...mockReactionData, type: 'unknown' as ReactionType });
    expect(invalidReaction.getEmoji()).toBe('👍');
  });
});
