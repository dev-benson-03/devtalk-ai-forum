import type { Route } from "./+types/userdashboard";
import { UserDashboardPage } from "~/account/UserDashboard";


export function meta({}: Route.MetaArgs) {
  return [
    { title: "User Dashboard Page" },
    { name: "description", content: "Welcome, User!" },
  ];
}

export default function UserDashboard() {
    return <UserDashboardPage />;
}

