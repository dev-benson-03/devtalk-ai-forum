import { useState } from "react";
import { Link, useParams } from "react-router";
import { Footer } from "../components/footer/footer";
import { NavBar } from "../components/navbar/navbar";
import { useComments, useFirestore, useForum } from "../hooks/useFirestore";
import ForumDetailPage from "~/forum/forum-detail";

export function meta() {
    return [
        { title: "Forum Discussion" },
        { name: "description", content: "Join the discussion in this forum." },
    ];
}

export default function ForumDetail() {
    return <ForumDetailPage />;
}
