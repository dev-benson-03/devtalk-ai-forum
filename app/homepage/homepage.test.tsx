import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HomePage } from "./homepage";

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("HomePage", () => {
  it("renders hero section and buttons", () => {
    renderWithRouter(<HomePage />);
    expect(screen.getByRole("button", { name: /create forum/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse forums/i })).toBeInTheDocument();
  });
});
