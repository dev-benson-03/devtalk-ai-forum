import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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

describe("CreateForumPage - Component Rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(<CreateForumPageWithRouter />);
    expect(screen.getByText("Create New Forum")).toBeInTheDocument();
  });

  it("displays the form title", () => {
    render(<CreateForumPageWithRouter />);
    expect(screen.getByRole("heading", { name: "Create New Forum" })).toBeInTheDocument();
  });

  it("renders all form fields with correct labels", () => {
    render(<CreateForumPageWithRouter />);
    
    expect(screen.getByLabelText(/forum title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/main question/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/time limit/i)).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    render(<CreateForumPageWithRouter />);
    
    expect(screen.getByRole("button", { name: /create forum/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows required attributes on required fields", () => {
    render(<CreateForumPageWithRouter />);
    
    expect(screen.getByLabelText(/forum title/i)).toBeRequired();
    expect(screen.getByLabelText(/description/i)).toBeRequired();
    expect(screen.getByLabelText(/main question/i)).toBeRequired();
    expect(screen.getByLabelText(/time limit/i)).toBeRequired();
  });
});
