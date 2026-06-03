import { fireEvent, screen } from '@testing-library/react';
import {
    expectedCategories,
    expectedTimeOptions,
    fillValidForm,
    mockCreateForum,
    renderCreateForumPage,
    setupTestEnvironment,
} from './create-forum-helpers';

describe('create-forum-helpers', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  it('renders CreateForumPage', () => {
    const { container } = renderCreateForumPage();
    expect(container).toBeInTheDocument();
  });

  it('fills valid form data', () => {
    renderCreateForumPage();
    fillValidForm();
    expect(screen.getByLabelText(/forum title/i)).toHaveValue('Test Forum');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Test description');
    expect(screen.getByLabelText(/main question/i)).toHaveValue('Test question?');
    expect(screen.getByLabelText(/category/i)).toHaveValue('Technology');
  });

  it('clears mocks and resets location', () => {
    window.location.href = 'test';
    jest.spyOn(window.history, 'back');
    setupTestEnvironment();
    expect(window.location.href).toBe('http://localhost/');
  });

  it('expectedCategories contains Technology', () => {
    expect(expectedCategories).toContain('Technology');
  });

  it('expectedTimeOptions is array', () => {
    expect(Array.isArray(expectedTimeOptions)).toBe(true);
  });

  it('calls mockCreateForum on submit', () => {
    renderCreateForumPage();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create forum/i }));
    expect(mockCreateForum).toHaveBeenCalled();
  });
});
