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

// Wrapper component to provide Router context
const CreateForumPageWithRouter = () => (
  <MemoryRouter>
    <CreateForumPage />
  </MemoryRouter>
);

describe("CreateForumPage - Form Fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("title input accepts text and updates", () => {
    render(<CreateForumPageWithRouter />);
    const titleInput = screen.getByLabelText(/forum title/i);
    
    fireEvent.change(titleInput, { target: { value: "Test Forum Title" } });
    expect(titleInput).toHaveValue("Test Forum Title");
  });

  it("description textarea accepts text and updates", () => {
    render(<CreateForumPageWithRouter />);
    const descriptionInput = screen.getByLabelText(/description/i);
    
    fireEvent.change(descriptionInput, { target: { value: "Test forum description" } });
    expect(descriptionInput).toHaveValue("Test forum description");
  });

  it("question textarea accepts text and updates", () => {
    render(<CreateForumPageWithRouter />);
    const questionInput = screen.getByLabelText(/main question/i);
    
    fireEvent.change(questionInput, { target: { value: "What is your question?" } });
    expect(questionInput).toHaveValue("What is your question?");
  });

  it("category dropdown shows all available categories", () => {
    render(<CreateForumPageWithRouter />);
    
    const expectedCategories = [
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

    expectedCategories.forEach(category => {
      expect(screen.getByRole("option", { name: category })).toBeInTheDocument();
    });
  });

  it("time limit dropdown shows all time options and defaults to 24 hours", () => {
    render(<CreateForumPageWithRouter />);
    const timeLimitSelect = screen.getByLabelText(/time limit/i);
    
    expect(timeLimitSelect).toHaveValue("0.083");
    expect(screen.getByRole("option", { name: "5 minutes" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "15 minutes" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "30 minutes" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1 hour" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "6 hours" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "12 hours" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "24 hours (1 day)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "48 hours (2 days)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "72 hours (3 days)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1 week" })).toBeInTheDocument();
  });

  it("category selection updates form state", () => {
    render(<CreateForumPageWithRouter />);
    const categorySelect = screen.getByLabelText(/category/i);
    
    fireEvent.change(categorySelect, { target: { value: "Technology" } });
    expect(categorySelect).toHaveValue("Technology");
  });

  it("time limit selection updates form state", () => {
    render(<CreateForumPageWithRouter />);
    const timeLimitSelect = screen.getByLabelText(/time limit/i);
    
    fireEvent.change(timeLimitSelect, { target: { value: "48" } });
    expect(timeLimitSelect).toHaveValue("48");
  });
});
