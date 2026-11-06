import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginPage } from '../login';

// Mock firebase/auth before tests
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  getIdTokenResult: jest.fn(async () => ({ claims: {} })),
  getAuth: jest.fn(() => ({})), // Add this line
}));

const signInAs = async (uid: string) => {
  const { signInWithEmailAndPassword } = require('firebase/auth');
  (signInWithEmailAndPassword as jest.Mock).mockResolvedValue({ user: { uid } });
  window.alert = jest.fn();
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /log in/i }));
  await waitFor(() => expect(window.alert).toHaveBeenCalled());
};

describe('LoginPage', () => {
  test('renders login form', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  test('shows error on invalid credentials', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'wrong@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
  });

  test('calls onLogin with correct credentials', async () => {
    const { signInWithEmailAndPassword } = require('firebase/auth');
    (signInWithEmailAndPassword as jest.Mock).mockResolvedValue({ user: { uid: 'testuid' } });

    window.alert = jest.fn();
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/logged in/i));
    });
  });

  test('shows the admin message only for a verified admin claim, read from a fresh token', async () => {
    const { getIdTokenResult } = require('firebase/auth');
    (getIdTokenResult as jest.Mock).mockResolvedValueOnce({ claims: { admin: true } });
    await signInAs('any-uid');
    expect(window.alert).toHaveBeenCalledWith('Admin logged in!');
    expect(getIdTokenResult).toHaveBeenCalledWith({ uid: 'any-uid' }, true);
  });

  test('ignores the old hardcoded admin UID', async () => {
    await signInAs('g0035irux7MA70QfUOi3xb57bmg1');
    expect(window.alert).toHaveBeenCalledWith('User logged in!');
  });

  test('ignores a non-boolean admin claim', async () => {
    const { getIdTokenResult } = require('firebase/auth');
    (getIdTokenResult as jest.Mock).mockResolvedValueOnce({ claims: { admin: 'true' } });
    await signInAs('mallory');
    expect(window.alert).toHaveBeenCalledWith('User logged in!');
  });

  test('clears the old sessionStorage role flags', async () => {
    sessionStorage.setItem('role', 'admin');
    sessionStorage.setItem('admin', 'true');
    await signInAs('any-uid');
    expect(sessionStorage.getItem('role')).toBeNull();
    expect(sessionStorage.getItem('admin')).toBeNull();
    expect(sessionStorage.getItem('anonymous')).toBe('false');
  });
});
