import { fireEvent, render, screen } from '@testing-library/react';
import Message from '../message';

describe('Message filter UI', () => {
  it('updates author filter', () => {
    render(<Message />);
    const authorInput = screen.getAllByRole("textbox").map(input => input as HTMLInputElement).find(input => input.placeholder === "Filter by author...") as HTMLInputElement;
    fireEvent.change(authorInput, { target: { value: 'Alice' } });
    expect(authorInput.value).toBe('Alice');
  });

  it('updates start date filter', () => {
    render(<Message />);
    const dateInput = screen.getByRole("textbox", { name: "" }) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2025-10-26' } });
    expect(dateInput.value).toBe('2025-10-26');
  });

  it('updates limit filter', () => {
    render(<Message />);
    const limitSelect = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(limitSelect, { target: { value: '10' } });
    expect(limitSelect.value).toBe('10');
  });
});
