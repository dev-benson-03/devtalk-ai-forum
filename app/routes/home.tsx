import { HomePage } from "../homepage/homepage";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Home Page" },
    { name: "description", content: "The Home Page Of TITLE_GOES_HERE" },
  ];
}

export default function Home() {
  return <HomePage />;
}

