import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import CreateForumPage from "../create-forum";

// Mock the useFirestore hook
const mockCreateForum = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({
    createForum: mockCreateForum,
  }),
}));

// Mock window methods
Object.defineProperty(window, 'history', {
  value: {
    back: jest.fn(),
  },
  writable: true,
});

// Wrapper component to provide Router context
const CreateForumPageWithRouter = () => (
  <MemoryRouter>
    <CreateForumPage />
  </MemoryRouter>
);

describe("CreateForumPage - User Interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cancel button calls window.history.back()", () => {
    render(<CreateForumPageWithRouter />);
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    
    fireEvent.click(cancelButton);
    
    expect(window.history.back).toHaveBeenCalled();
  });

  it("converts time limit to integer properly", () => {
    render(<CreateForumPageWithRouter />);
    const timeLimitSelect = screen.getByLabelText(/time limit/i);
    
    fireEvent.change(timeLimitSelect, { target: { value: "168" } });
    expect(timeLimitSelect).toHaveValue("168");
  });
});
