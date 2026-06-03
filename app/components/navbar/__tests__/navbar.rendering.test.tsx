import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NavBar } from "../navbar";

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("NavBar Rendering", () => {
  it("renders without crashing", () => {
    expect(() => renderWithRouter(<NavBar />)).not.toThrow();
  });

  it("renders the Forum Hub brand link correctly", () => {
    renderWithRouter(<NavBar />);
    // Instead of getByRole('link', ...), check for the button or text that triggers navigation
    const brandButton = screen.getByRole("button", { name: /devtalk logo/i });
    expect(brandButton).toBeInTheDocument();
    // Optionally, check window.location or mock navigation
  });

  it("renders all navigation elements", () => {
    renderWithRouter(<NavBar />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DevTalk Logo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
  });
});