import * as MessageIndex from '../index';

describe('message/index exports', () => {
  it('should export Message', () => {
    expect(MessageIndex.Message).toBeDefined();
  });
  it('should export Reaction', () => {
    expect(MessageIndex.Reaction).toBeDefined();
  });
  it('should export User', () => {
    expect(MessageIndex.User).toBeDefined();
  });
  it('should export MessageService', () => {
    expect(MessageIndex.MessageService).toBeDefined();
  });
  it('should export ModerationService', () => {
    expect(MessageIndex.ModerationService).toBeDefined();
  });
  it('should export ReactionService', () => {
    expect(MessageIndex.ReactionService).toBeDefined();
  });
  it('should export MessageComposer', () => {
    expect(MessageIndex.MessageComposer).toBeDefined();
  });
  it('should export MessageItem', () => {
    expect(MessageIndex.MessageItem).toBeDefined();
  });
  it('should export MessageList', () => {
    expect(MessageIndex.MessageList).toBeDefined();
  });
  it('should export ApiClient', () => {
    expect(MessageIndex.ApiClient).toBeDefined();
  });
  it('should export Logger', () => {
    expect(MessageIndex.Logger).toBeDefined();
  });
});
