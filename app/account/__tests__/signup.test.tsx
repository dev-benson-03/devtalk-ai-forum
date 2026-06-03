import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignUpPage } from '../signup';

// Mock firebase/auth and window.alert
jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
    getAuth: jest.fn(() => ({})), // Add this line
}));
window.alert = jest.fn();
const mockSetItem = jest.fn();
Object.defineProperty(window, 'sessionStorage', {
  value: { setItem: mockSetItem, getItem: jest.fn(() => 'user') },
  writable: true,
});

describe('SignUpPage', () => {
  test('renders signup form', () => {
    render(<SignUpPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  test('handles successful sign up as admin', async () => {
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } = require('firebase/auth');
    createUserWithEmailAndPassword.mockResolvedValue({});
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'g0035irux7MA70QfUOi3xb57bmg1' } });
    updateProfile.mockResolvedValue({});
    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'Admin' } });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith('role', 'admin');
      expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/admin logged in/i));
    });
  });

  test('handles successful sign up as regular user', async () => {
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } = require('firebase/auth');
    createUserWithEmailAndPassword.mockResolvedValue({});
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'regularuid' } });
    updateProfile.mockResolvedValue({});
    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'User' } });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith('role', 'user');
      expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/user logged in/i));
    });
  });
});