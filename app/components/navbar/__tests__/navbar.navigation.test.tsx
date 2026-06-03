import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NavBar } from "../navbar";

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("NavBar Navigation Links", () => {
  it("brand button navigates to home page", () => {
    renderWithRouter(<NavBar />);
    const brandButton = screen.getByRole("button", { name: /DevTalk Logo/i });
    expect(brandButton).toBeInTheDocument();
  });
});