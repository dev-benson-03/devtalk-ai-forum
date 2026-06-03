import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ForumsPage } from "../forumspage";

const mockUseForums = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useForums: () => mockUseForums(),
}));

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn((auth, cb) => {
    cb({}); // Simulate authenticated user
    return () => {};
  }),
}));

describe("ForumsPage filter UI interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseForums.mockReturnValue({ forums: [], loading: false, error: null });
  });

  it("selects 'All' category via radio and span click", () => {
    render(
      <MemoryRouter>
        <ForumsPage />
      </MemoryRouter>
    );
    const allRadios = screen.getAllByRole("radio", { name: /All/i });
    const allStatusRadio = allRadios[1]; // The second "All" radio is for status
    const allSpan = screen.getAllByText(/All/i).find(el => el.tagName === "SPAN");
    fireEvent.click(allStatusRadio);
    expect(allStatusRadio).toBeChecked();
    fireEvent.click(allSpan!);
    expect(allStatusRadio).toBeChecked();
    expect(allSpan).toHaveClass("bg-blue-600");
  });

  it("selects a specific category via radio and span click", () => {
    render(
      <MemoryRouter>
        <ForumsPage />
      </MemoryRouter>
    );
    const techRadio = screen.getByRole("radio", { name: /Technology/i });
    const techSpan = screen.getAllByText(/Technology/i).find(el => el.tagName === "SPAN");
    fireEvent.click(techRadio);
    expect(techRadio).toBeChecked();
    fireEvent.click(techSpan!);
    expect(techRadio).not.toBeChecked();
    expect(techSpan).toHaveClass("flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold bg-transparent text-gray-700 border-gray-300 hover:border-blue-400");
  });

  it("selects 'All' status via radio and span click", () => {
    render(
      <MemoryRouter>
        <ForumsPage />
      </MemoryRouter>
    );
    const allRadios = screen.getAllByRole("radio", { name: /All/i });
    const allStatusRadio = allRadios[1]; // status filter radio
    const allStatusSpan = screen.getAllByText(/All/i).find(el => el.tagName === "SPAN" && el.textContent?.trim() === "All");
    fireEvent.click(allStatusRadio);
    expect(allStatusRadio).toBeChecked();
    fireEvent.click(allStatusSpan!);
    expect(allStatusRadio).toBeChecked();
    expect(allStatusSpan).toHaveClass("bg-blue-600");
  });

  it("selects 'Open' status via radio and span click", () => {
    render(
      <MemoryRouter>
        <ForumsPage />
      </MemoryRouter>
    );
    const openRadio = screen.getByRole("radio", { name: /Open/i });
    const openSpan = screen.getAllByText(/Open/i).find(el => el.tagName === "SPAN");
    fireEvent.click(openRadio);
    expect(openRadio).toBeChecked();
    fireEvent.click(openSpan!);
    expect(openRadio).not.toBeChecked();
    expect(openSpan).toHaveClass("flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold bg-transparent text-gray-700 border-gray-300 hover:border-blue-400");
  });
});
