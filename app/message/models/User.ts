/**
 * models/User.ts
 * Defines the User data model for messaging system participants.
 */

export interface UserData {
  id: number;
  username: string;
  email: string;
  createdAt: string;
  isActive?: boolean;
}

export class User {
  /**
   * Represents a user in the messaging system.
   */
  public id: number;
  public username: string;
  public email: string;
  public createdAt: string;
  public isActive: boolean;

  constructor(data: UserData) {
    this.id = data.id;
    this.username = data.username;
    this.email = data.email;
    this.createdAt = data.createdAt;
    this.isActive = data.isActive ?? true;
  }

  /**
   * Return a plain object representation of the user.
   */
  toObject(): UserData {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      createdAt: this.createdAt,
      isActive: this.isActive
    };
  }

  /**
   * Check if the user account is active.
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Get display name for the user
   */
  getDisplayName(): string {
    return this.username;
  }
}
