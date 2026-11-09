/**
 * Legacy timestamp values must not stop the forum or comment lists from
 * loading, and mixed valid and unreadable values sort deterministically.
 */
import { render } from '@testing-library/react';
import { useComments, useForums } from './useFirestore';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  onSnapshot: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  Timestamp: jest.fn(),
}));
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('./forum-data', () => ({ listedForumsQuery: jest.fn() }));
jest.mock('../forum/publish-client', () => ({ PublishError: class extends Error {}, publishForum: jest.fn(), publishComment: jest.fn() }));

const at = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms });
const snapshotOf = (docs: Array<[string, Record<string, unknown>]>) => {
  require('firebase/firestore').onSnapshot.mockImplementation((_q: unknown, success: (s: unknown) => void) => {
    success({ size: docs.length, docs: docs.map(([id, data]) => ({ id, data: () => data })) });
    return jest.fn();
  });
};

function hookResult<T>(useHook: () => T): T {
  let result!: T;
  function Probe() {
    result = useHook();
    return null;
  }
  render(<Probe />);
  return result;
}

describe('useComments with legacy createdAt values', () => {
  it('loads every comment, oldest first, unreadable dates first and ties by id', () => {
    snapshotOf([
      ['c-late', { createdAt: at(3000) }],
      ['c-malformed', { createdAt: { toDate: 'yesterday' } }],
      ['c-string', { createdAt: '1970-01-01T00:00:02Z' }],
      ['c-early', { createdAt: at(1000) }],
      ['c-missing', {}],
      ['c-throws', { createdAt: { toDate: () => { throw new Error('boom'); } } }],
      ['c-tie', { createdAt: at(3000) }],
    ]);
    const result = hookResult(() => useComments('f1'));
    expect(result.error).toBeNull();
    expect(result.comments.map((c) => c.id)).toEqual([
      'c-malformed', 'c-missing', 'c-throws', 'c-early', 'c-string', 'c-late', 'c-tie',
    ]);
  });
});

describe('useForums with legacy endTime values', () => {
  it('loads every listed forum, soonest end first, unreadable end times first and ties by id', () => {
    snapshotOf([
      ['f-late', { endTime: at(3000) }],
      ['f-malformed', { endTime: { toMillis: 'soon' } }],
      ['f-none', {}],
      ['f-early', { endTime: at(1000) }],
      ['f-string', { endTime: '1970-01-01T00:00:02Z' }],
      ['f-nan', { endTime: { toDate: () => new Date(NaN), toMillis: () => NaN } }],
      ['f-tie', { endTime: at(3000) }],
    ]);
    const result = hookResult(() => useForums());
    expect(result.error).toBeNull();
    expect(result.forums.map((f) => f.id)).toEqual(['f-malformed', 'f-nan', 'f-none', 'f-early', 'f-string', 'f-late', 'f-tie']);
  });
});
