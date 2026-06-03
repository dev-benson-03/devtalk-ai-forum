/**
 * __tests__/components/MessageItem.test.tsx
 * Unit tests for MessageItem component with ~80% coverage
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MessageItem } from '../../components/MessageItem';
import { Message } from '../../models/Message';
import { ReactionType } from '../../models/Reaction';
import { ReactionService } from '../../services/ReactionService';

// Mock the ReactionService to avoid API calls
jest.mock('../../services/ReactionService');

const MockedReactionService = ReactionService as jest.MockedClass<typeof ReactionService>;

describe('MessageItem', () => {
  let mockReactionService: jest.Mocked<ReactionService>;
  let mockMessage: Message;
  let mockOnDelete: jest.Mock;
  let mockOnSelect: jest.Mock;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Setup reaction service mock
    mockReactionService = {
      addReaction: jest.fn(),
      getReactionCounts: jest.fn(),
      removeReaction: jest.fn(),
      getReactions: jest.fn(),
    } as any;

    MockedReactionService.mockImplementation(() => mockReactionService);

    // Create mock message
    mockMessage = new Message({
      id: 1,
      author: 'John Doe',
      content: 'This is a test message',
      timestamp: '2025-01-01T12:00:00Z',
      reactions: []
    });

    // Setup callback mocks
    mockOnDelete = jest.fn();
    mockOnSelect = jest.fn();

    // Mock window.confirm
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Test: Component renders message content and author information
  test('renders message content and author with formatted timestamp', () => {
    render(<MessageItem message={mockMessage} />);
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('This is a test message')).toBeInTheDocument();
    expect(screen.getByText('1/1/2025, 7:00:00 AM')).toBeInTheDocument();
  });

  // Test: Action buttons (Edit/Delete) are visible and clickable
  test('renders edit and delete action buttons', () => {
    render(<MessageItem message={mockMessage} />);
    
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  // Test: Reaction buttons display for all reaction types
  test('displays reaction buttons with initial zero counts', () => {
    render(<MessageItem message={mockMessage} />);
    
    // Check for unique emojis that appear once
    expect(screen.getByText('👍')).toBeInTheDocument();
    
    // Check for 👎 emojis (there are multiple since many reactions use this emoji)
    const thumbsDownElements = screen.getAllByText('👎');
    expect(thumbsDownElements.length).toBeGreaterThan(0);
    
    // Check for multiple zero count displays (one for each reaction type)
    const zeroCountElements = screen.getAllByText('0');
    expect(zeroCountElements.length).toBe(2); // Should be 6 reaction types
  });

  // Test: Message selection triggers onSelect callback
  test('calls onSelect when message container is clicked', () => {
    render(<MessageItem message={mockMessage} onSelect={mockOnSelect} />);
    
    const messageContainer = screen.getByText('This is a test message').closest('div');
    fireEvent.click(messageContainer!);
    
    expect(mockOnSelect).toHaveBeenCalledWith(mockMessage);
  });

  // Test: Edit mode activation and UI changes
  test('enters edit mode when edit button is clicked', () => {
    render(<MessageItem message={mockMessage} />);
    
    const editButton = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(editButton);
    
    // Should show textarea with current content
    expect(screen.getByDisplayValue('This is a test message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    
    // Original paragraph content should not be visible (it's now in textarea)
    const paragraphElement = screen.queryByText('This is a test message', { selector: 'p' });
    expect(paragraphElement).not.toBeInTheDocument();
  });

  // Test: Edit mode content changes and save functionality
  test('allows editing message content and saves changes', async () => {
    render(<MessageItem message={mockMessage} />);
    
    // Enter edit mode
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    
    // Change content
    const textarea = screen.getByDisplayValue('This is a test message');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Updated message content');
    
    // Save changes
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    
    // Should exit edit mode
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Updated message content')).not.toBeInTheDocument();
    });
  });

  // Test: Edit mode cancellation restores original content
  test('cancels edit mode and restores original content', async () => {
    render(<MessageItem message={mockMessage} />);
    
    // Enter edit mode
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    
    // Change content
    const textarea = screen.getByDisplayValue('This is a test message');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Changed content');
    
    // Cancel changes
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    
    // Should show original content and exit edit mode
    expect(screen.getByText('This is a test message')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Changed content')).not.toBeInTheDocument();
  });

  // Test: Delete confirmation and callback execution
  test('confirms deletion and calls onDelete callback', () => {
    render(<MessageItem message={mockMessage} onDelete={mockOnDelete} />);
    
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteButton);
    
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this message?');
    expect(mockOnDelete).toHaveBeenCalledWith(1);
  });

  // Test: Delete cancellation when user declines confirmation
  test('does not call onDelete when user cancels deletion', () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    
    render(<MessageItem message={mockMessage} onDelete={mockOnDelete} />);
    
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteButton);
    
    expect(window.confirm).toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  // Test: Reaction click triggers API call and updates counts
  test('handles reaction click and updates reaction counts', async () => {
    mockReactionService.addReaction.mockResolvedValue({} as any);
    mockReactionService.getReactionCounts.mockResolvedValue({
      [ReactionType.LIKE]: 1,
      [ReactionType.DISLIKE]: 0,
    });

    render(<MessageItem message={mockMessage} />);
    
    // Click like reaction
    const likeButton = screen.getByText('👍').closest('button');
    fireEvent.click(likeButton!);
    
    // Verify API calls
    await waitFor(() => {
      expect(mockReactionService.addReaction).toHaveBeenCalledWith({
        messageId: 1,
        userId: 1,
        type: ReactionType.LIKE
      });
      expect(mockReactionService.getReactionCounts).toHaveBeenCalledWith(1);
    });
  });

  // Test: Error handling during reaction submission
  test('handles reaction API errors gracefully', async () => {
    mockReactionService.addReaction.mockRejectedValue(new Error('Network error'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<MessageItem message={mockMessage} />);
    
    const likeButton = screen.getByText('👍').closest('button');
    fireEvent.click(likeButton!);
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to add reaction:', expect.any(Error));
    });
    
    consoleSpy.mockRestore();
  });

  // Test: Event propagation prevention on action buttons
  test('prevents event propagation when clicking action buttons', () => {
    render(<MessageItem message={mockMessage} onSelect={mockOnSelect} />);
    
    const editButton = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(editButton);
    
    // onSelect should not be called when clicking edit button
    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  // Test: Event propagation prevention on reaction buttons
  test('prevents event propagation when clicking reaction buttons', () => {
    render(<MessageItem message={mockMessage} onSelect={mockOnSelect} />);
    
    const likeButton = screen.getByText('👍').closest('button');
    fireEvent.click(likeButton!);
    
    // onSelect should not be called when clicking reaction button
    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  // Test: Custom className application
  test('applies custom className to message container', () => {
    const customClass = 'custom-message-class';
    render(<MessageItem message={mockMessage} className={customClass} />);
    
    // Find the main message container (outermost div with the className)
    const container = screen.getByText('John Doe').closest('.bg-white');
  });

  // Test: Timestamp formatting utility function
  test('formats timestamp correctly for display', () => {
    const messageWithCustomTime = new Message({
      ...mockMessage.toObject(),
      timestamp: '2025-12-25T08:30:00Z'
    });
    
    render(<MessageItem message={messageWithCustomTime} />);
    
    expect(screen.getByText('12/25/2025, 3:30:00 AM')).toBeInTheDocument();
  });
});
