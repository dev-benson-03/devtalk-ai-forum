/* eslint-disable react/jsx-no-undef */
import { SignUpPage } from "~/account/signup";
import type { Route } from "./+types/signup";

export function meta({}: Route.MetaArgs) {
    return [
        { title: "Signup" },
        { name: "description", content: "Create an account to participate in forums." },
    ];
}

export default function Signup() {
    return <SignUpPage />;
}