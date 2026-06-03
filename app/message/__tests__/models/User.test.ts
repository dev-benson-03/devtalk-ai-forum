/**
 * __tests__/models/User.test.ts
 * Jest tests for the User model
 */

import { User, UserData } from '../../models/User';

describe('User Model', () => {
  // Test data setup
  const mockUserData: UserData = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    createdAt: '2024-01-01T00:00:00Z',
    isActive: true
  };

  const mockUserDataMinimal: UserData = {
    id: 2,
    username: 'minimaluser',
    email: 'minimal@example.com',
    createdAt: '2024-01-02T00:00:00Z'
    // isActive omitted - should default to true
  };

  // Constructor Tests
  describe('Constructor', () => {
    // Constructor initializes all fields correctly with complete data
    it('should initialize all fields correctly with complete UserData', () => {
      const user = new User(mockUserData);
      
      expect(user.id).toBe(1);
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
      expect(user.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(user.isActive).toBe(true);
    });

    // Constructor defaults isActive to true when omitted
    it('should default isActive to true when not provided', () => {
      const user = new User(mockUserDataMinimal);
      
      expect(user.id).toBe(2);
      expect(user.username).toBe('minimaluser');
      expect(user.email).toBe('minimal@example.com');
      expect(user.createdAt).toBe('2024-01-02T00:00:00Z');
      expect(user.isActive).toBe(true);
    });
  });

  // Serialization Tests
  describe('toObject()', () => {
    // toObject returns plain object matching UserData interface
    it('should return plain object via toObject method', () => {
      const user = new User(mockUserData);
      const result = user.toObject();
      
      expect(result).toEqual(mockUserData);
      expect(typeof result).toBe('object');
      expect(result.constructor).toBe(Object);
    });

    // toObject preserves all field values correctly
    it('should preserve all field values in serialized object', () => {
      const user = new User(mockUserDataMinimal);
      const result = user.toObject();
      
      expect(result.id).toBe(2);
      expect(result.username).toBe('minimaluser');
      expect(result.email).toBe('minimal@example.com');
      expect(result.isActive).toBe(true);
    });
  });

  // Method Behavior Tests
  describe('getIsActive()', () => {
    // getIsActive returns correct boolean value
    it('should return correct isActive status', () => {
      const activeUser = new User(mockUserData);
      expect(activeUser.getIsActive()).toBe(true);
      
      const inactiveUser = new User({ ...mockUserData, isActive: false });
      expect(inactiveUser.getIsActive()).toBe(false);
    });
  });

  describe('getDisplayName()', () => {
    // getDisplayName returns username
    it('should return username as display name', () => {
      const user = new User(mockUserData);
      expect(user.getDisplayName()).toBe('testuser');
      
      const user2 = new User(mockUserDataMinimal);
      expect(user2.getDisplayName()).toBe('minimaluser');
    });
  });

  // Edge Cases and Data Integrity Tests
  describe('Edge Cases', () => {
    // Handles special characters in username and email
    it('should handle special characters in username and email', () => {
      const specialUserData: UserData = {
        id: 3,
        username: 'user@#$%^&*()',
        email: 'test+special@domain.co.uk',
        createdAt: '2024-01-03T00:00:00Z'
      };
      
      const user = new User(specialUserData);
      expect(user.username).toBe('user@#$%^&*()');
      expect(user.email).toBe('test+special@domain.co.uk');
      expect(user.getDisplayName()).toBe('user@#$%^&*()');
    });

    // Data immutability - toObject doesn't affect original instance
    it('should maintain data integrity after toObject call', () => {
      const user = new User(mockUserData);
      const originalUsername = user.username;
      const obj = user.toObject();
      
      obj.username = 'modified';
      expect(user.username).toBe(originalUsername);
      expect(user.getDisplayName()).toBe('testuser');
    });
  });
});
