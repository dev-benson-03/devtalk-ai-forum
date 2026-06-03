// Main component exports
export { default } from "./message";

// Model exports
export { Message } from './models/Message';
export type { MessageData, ReactionData } from './models/Message';
export { Reaction, ReactionType } from './models/Reaction';
export { User } from './models/User';
export type { UserData } from './models/User';

// Service exports
export { MessageService } from './services/MessageService';
export type { CreateMessageRequest, MessageFilters } from './services/MessageService';
export { ModerationService } from './services/ModerationService';
export type { ModerationResult } from './services/ModerationService';
export { ReactionService } from './services/ReactionService';
export type { AddReactionRequest } from './services/ReactionService';

// Component exports
export { MessageComposer } from './components/MessageComposer';
export { MessageItem } from './components/MessageItem';
export { MessageList } from './components/MessageList';

// Utility exports
export { ApiClient } from './utils/apiClient';
export type { ApiConfig, ApiResponse } from './utils/apiClient';
export { LogLevel, Logger } from './utils/logger';
export type { LogEntry } from './utils/logger';

