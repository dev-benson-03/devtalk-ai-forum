import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("forums", "routes/forums.tsx"),
    route("create-forum", "routes/create-forum.tsx"),
    route("forum/:forumId", "routes/forum-detail.tsx"),
    route("messages", "message/message.tsx"),
    route("signup","routes/signup.tsx"),
    route("login","routes/login.tsx"),
    route("userdashboard","routes/userdashboard.tsx"),
    route("api/analyzeMessages", "api/analyzeMessages.ts")
] satisfies RouteConfig;
