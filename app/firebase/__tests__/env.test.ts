import { readFirebaseConfig } from '../env';

const fullEnv = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'devtalk-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'devtalk-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'devtalk-test.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abc123',
};

describe('readFirebaseConfig', () => {
  it('maps every env variable to its Firebase config key', () => {
    expect(readFirebaseConfig(fullEnv)).toEqual({
      apiKey: 'test-api-key',
      authDomain: 'devtalk-test.firebaseapp.com',
      projectId: 'devtalk-test',
      storageBucket: 'devtalk-test.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abc123',
    });
  });

  it('throws naming every missing variable instead of falling back', () => {
    expect(() => readFirebaseConfig({})).toThrow(
      'Missing Firebase environment variables: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, ' +
        'VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, ' +
        'VITE_FIREBASE_APP_ID.'
    );
  });

  it('treats blank values as missing', () => {
    expect(() =>
      readFirebaseConfig({ ...fullEnv, VITE_FIREBASE_PROJECT_ID: '   ' })
    ).toThrow('Missing Firebase environment variables: VITE_FIREBASE_PROJECT_ID.');
  });

  it('never includes provided values in the error message', () => {
    try {
      readFirebaseConfig({ ...fullEnv, VITE_FIREBASE_APP_ID: undefined });
      throw new Error('expected readFirebaseConfig to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('VITE_FIREBASE_APP_ID');
      expect(message).not.toContain('test-api-key');
      expect(message).not.toContain('devtalk-test');
    }
  });
});
