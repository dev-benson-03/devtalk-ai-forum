import { ForumsPage } from "../browseforums/forumspage";
import type { Route } from "./+types/forums";

export function meta({}: Route.MetaArgs) {
    return [
        { title: "Browse Forums" },
        { name: "description", content: "Browse and participate in forums." },
    ];
}

export default function Forums() {
    return <ForumsPage />;
}

