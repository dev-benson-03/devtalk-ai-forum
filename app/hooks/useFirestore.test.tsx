import { render } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import { useComments, useFirestore, useForum, useForums } from './useFirestore';

// Mock Firestore methods
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(async () => ({ id: 'forum123' })),
  collection: jest.fn(),
  deleteDoc: jest.fn(async () => {}),
  doc: jest.fn(),
  getDoc: jest.fn(async () => ({ exists: () => true, id: 'forum123', data: () => ({ title: 'Test', isActive: true }) })),
  increment: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  serverTimestamp: jest.fn(),
  Timestamp: jest.fn(),
  updateDoc: jest.fn(async () => {}),
  where: jest.fn(),
}));

jest.mock('../firebase', () => ({ db: {} }));

function HookTest({ callback }: { callback: (hook: any) => void }) {
  const hook = useFirestore();
  callback(hook);
  return null;
}

describe('useFirestore', () => {
  it('createForum returns forum id on success', async () => {
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    const forumData = { title: 'Test', description: '', question: '', creatorId: 'u1', creatorName: 'User', isActive: true, isAdminDeleted: false, upvotes: 0, downvotes: 0, commentCount: 0, summary: '', actionRoadmap: [], messages: [] };
    const id = await hook.createForum(forumData);
    expect(id).toBe('forum123');
  });

  it('updateForum calls updateDoc', async () => {
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    await hook.updateForum('forum123', { title: 'Updated' });
    expect(require('firebase/firestore').updateDoc).toHaveBeenCalled();
  });

  it('deleteForum calls deleteDoc', async () => {
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    await hook.deleteForum('forum123');
    expect(require('firebase/firestore').deleteDoc).toHaveBeenCalled();
  });

  it('getForum returns forum data if exists', async () => {
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    const forum = await hook.getForum('forum123');
    expect(forum).toMatchObject({ id: 'forum123', title: 'Test', isActive: true });
  });
});

describe('useComments', () => {
  it('returns sorted comments for valid forumId', () => {
    const mockSnapshot = {
      docs: [
        { id: 'c1', data: () => ({ createdAt: { toDate: () => new Date(1000) }, userName: 'A' }) },
        { id: 'c2', data: () => ({ createdAt: { toDate: () => new Date(500) }, userName: 'B' }) },
      ],
    };
    require('firebase/firestore').onSnapshot.mockImplementation((query: any, success: any) => {
      success(mockSnapshot);
      return jest.fn();
    });
    let result: any;
    function Test() {
      result = useComments('forum123');
      return null;
    }
    render(<Test />);
    expect(result.comments[0].id).toBe('c2'); // Sorted by createdAt
    expect(result.loading).toBe(false);
    expect(result.error).toBe(null);
  });

  it('sets loading false if forumId is missing', () => {
    let result: any;
    function Test() {
      result = useComments('');
      return null;
    }
    render(<Test />);
    expect(result.loading).toBe(false);
  });

  it('handles error in snapshot callback', () => {
    require('firebase/firestore').onSnapshot.mockImplementation((query: any, success: any, error: any) => {
      error(new Error('fail'));
      return jest.fn();
    });
    let result: any;
    function Test() {
      result = useComments('forum123');
      return null;
    }
    render(<Test />);
    expect(result.error).toBe('Failed to connect to database');
    expect(result.loading).toBe(false);
  });
});

describe('useForum', () => {
  it('returns forum data for valid forumId', async () => {
    require('firebase/firestore').getDoc.mockResolvedValueOnce({ exists: () => true, id: 'f1', data: () => ({ title: 'Forum' }) });
    let result: any;
    function Test() {
      result = useForum('f1');
      return null;
    }
    await act(async () => { render(<Test />); });
    expect(result.forum).toMatchObject({ id: 'f1', title: 'Forum' });
    expect(result.loading).toBe(false);
    expect(result.error).toBe(null);
  });

  it('sets error if forumId is missing', () => {
    let result: any;
    function Test() {
      result = useForum('');
      return null;
    }
    render(<Test />);
    expect(result.error).toBe('No forum ID provided');
    expect(result.loading).toBe(false);
  });

  it('sets error if forum not found', async () => {
    require('firebase/firestore').getDoc.mockResolvedValueOnce({ exists: () => false });
    let result: any;
    function Test() {
      result = useForum('f2');
      return null;
    }
    await act(async () => { render(<Test />); });
    expect(result.forum).toBe(null);
    expect(result.error).toBe('Forum not found');
    expect(result.loading).toBe(false);
  });

  it('handles error from getDoc', async () => {
    require('firebase/firestore').getDoc.mockRejectedValueOnce(new Error('fail'));
    let result: any;
    function Test() {
      result = useForum('f3');
      return null;
    }
    await act(async () => { render(<Test />); });
    expect(result.forum).toBe(null);
    expect(result.error).toBe('Failed to load forum');
    expect(result.loading).toBe(false);
  });
});

describe('useForums', () => {
  it('returns sorted and filtered forums', () => {
    const mockSnapshot = {
      docs: [
        { id: 'f1', data: () => ({ isActive: true, isAdminDeleted: false, endTime: { toMillis: () => 2000 } }) },
        { id: 'f2', data: () => ({ isActive: false, isAdminDeleted: false, endTime: { toMillis: () => 1000 } }) },
        { id: 'f3', data: () => ({ isActive: true, isAdminDeleted: true, endTime: { toMillis: () => 3000 } }) },
      ],
    };
    require('firebase/firestore').onSnapshot.mockImplementation((query: any, success: any) => {
      success(mockSnapshot);
      return jest.fn();
    });
    let result: any;
    function Test() {
      result = useForums();
      return null;
    }
    render(<Test />);
    expect(result.forums.length).toBe(1); // Only f1 is active and not deleted
    expect(result.forums[0].id).toBe('f1');
    expect(result.loading).toBe(false);
    expect(result.error).toBe(null);
  });

  it('handles error in onSnapshot error callback', () => {
    require('firebase/firestore').onSnapshot.mockImplementation((query: any, success: any, error: any) => {
      error(new Error('fail'));
      return jest.fn();
    });
    let result: any;
    function Test() {
      result = useForums();
      return null;
    }
    render(<Test />);
    expect(result.error).toBe('Failed to connect to database');
    expect(result.loading).toBe(false);
  });
});

describe('getForum error handling', () => {
  it('returns null if forum not found', async () => {
    require('firebase/firestore').getDoc.mockResolvedValueOnce({ exists: () => false });
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    const result = await hook.getForum('notfound');
    expect(result).toBe(null);
  });

  it('throws and logs error if getDoc throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    require('firebase/firestore').getDoc.mockRejectedValueOnce(new Error('fail'));
    let hook: any;
    render(<HookTest callback={h => (hook = h)} />);
    await expect(hook.getForum('fail')).rejects.toThrow('fail');
    expect(errorSpy).toHaveBeenCalledWith('Error fetching forum:', expect.any(Error));
    errorSpy.mockRestore();
  });
});

// More tests for useForums can be added next
