import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NavBar } from "../navbar";

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("NavBar Accessibility", () => {
  it("has proper navigation landmark", () => {
    renderWithRouter(<NavBar />);
    const nav = screen.getByRole("navigation");
    expect(nav).toBeInTheDocument();
  });

  it("all links have accessible names", () => {
    renderWithRouter(<NavBar />);
    // Instead of getByRole('link', ...), check for the button or text that triggers navigation
    const brandButton = screen.getByRole('button', { name: /DevTalk Logo/i });
    expect(brandButton).toBeInTheDocument();
  });

  it("sign up link has accessible name", () => {
    renderWithRouter(<NavBar />);
    const signUpButton = screen.getByRole('button', { name: /log in/i });
    expect(signUpButton).toBeInTheDocument();
  });
});