import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import CreateForumPage from "../create-forum";

// Mock the useFirestore hook
export const mockCreateForum = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({
    createForum: mockCreateForum,
  }),
}));

// Mock window methods
// @ts-ignore
window.location = { href: '' };
Object.defineProperty(window, 'history', {
  value: {
    back: jest.fn(),
  },
  writable: true,
});

// Mock alert
global.alert = jest.fn();

// Wrapper component to provide Router context
export const CreateForumPageWithRouter = () => (
  <MemoryRouter>
    <CreateForumPage />
  </MemoryRouter>
);

// Helper function to fill valid form data
export const fillValidForm = () => {
  fireEvent.change(screen.getByLabelText(/forum title/i), { 
    target: { value: "Test Forum" } 
  });
  fireEvent.change(screen.getByLabelText(/description/i), { 
    target: { value: "Test description" } 
  });
  fireEvent.change(screen.getByLabelText(/main question/i), { 
    target: { value: "Test question?" } 
  });
  fireEvent.change(screen.getByLabelText(/category/i), { 
    target: { value: "Technology" } 
  });
};

// Helper function to render the component
export const renderCreateForumPage = () => {
  return render(<CreateForumPageWithRouter />);
};

// Setup function to clear mocks before each test
export const setupTestEnvironment = () => {
  jest.clearAllMocks();
  window.location.href = '';
};

// Expected categories for testing
export const expectedCategories = [
  "Technology",
  "Programming", 
  "Career Advice",
  "Education",
  "AI/Machine Learning",
  "Web Development",
  "Mobile Development",
  "General Discussion",
  "Other"
];

// Expected time options for testing
export const expectedTimeOptions = [
  { value: "1", text: "1 hour" },
  { value: "6", text: "6 hours" },
  { value: "12", text: "12 hours" },
  { value: "24", text: "24 hours (1 day)" },
  { value: "48", text: "48 hours (2 days)" },
  { value: "72", text: "72 hours (3 days)" },
  { value: "168", text: "1 week" }
];
