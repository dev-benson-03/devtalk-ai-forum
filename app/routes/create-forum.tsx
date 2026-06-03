import CreateForumPage from "~/forum/create-forum";

export function meta() {
    return [
        { title: "Create Forum" },
        { name: "description", content: "Create a new discussion forum." },
    ];
}

export default function CreateForum() {
    return <CreateForumPage />;
}
