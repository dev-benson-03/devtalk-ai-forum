# 💬 AI Forum Voting App

A full-stack website where users can create accounts, make forums based on questions or problems, vote on responses, and view AI-generated summaries once the forum closes.

---

## 🧠 Idea
Users can:
- Create and log in to their account  
- Create or join forums about random questions or problems  
- Upvote or downvote responses  
- View AI summaries and suggestions after the forum ends  

Admins can manage all forums and moderate content.

---

## 📘 User Stories & Acceptance Criteria

### 🧍‍♂️ User Story 1  
**As a user, I want to create/login to my account so my messages and votes are registered in my name.**

**Acceptance Criteria:**  
- Users can register and log in securely.  
- Each account has a unique username and email.  
- Successful login redirects to the home page.  
- Logged-in users’ posts and votes are tied to their account.  
- Session or token authentication keeps users logged in.
- Users can decide to be anonymous if they want to hide their account name.

---

### 🗂️ User Story 2  
**As a user, I want to create forums based on random problems/questions so others can respond and upvote/downvote them.**

**Acceptance Criteria:**  
- Logged-in users can create forums with a title, description, and question.  
- Each forum is tied to the creator’s account and timestamp.  
- Other users can comment and vote on forums.  
- Users can upvote or downvote posts and responses.  
- Each user can only vote once per post.  
- Forums are visible to all users once created.  

---

### 🤖 User Story 3  
**As a user, I want to view AI-generated summaries after the forum ends to see the general consensus and suggestions.**

**Acceptance Criteria:**  
- Each forum has a set end time (by default or by the creator).  
- Once time expires, the forum closes for new responses and votes.  
- An AI system summarizes the discussion using external APIs.  
- The summary highlights main points, user opinions, and possible solutions.  
- Users can view the AI-generated summary on the results page.  

---

### ⚙️ User Story 4  
**As an admin, I want to manage forums so I can update or remove them when needed.**

**Acceptance Criteria:**  
- Admins can view all active and closed forums.  
- Admins can update forum titles, descriptions, or status.  
- Admins can remove inappropriate or duplicate forums.  
- Admin actions require admin-level authentication.  
- Changes are updated immediately across the system.  

---

**Author:** Tyran Rice Jr.  
**Last Updated:** October 2025
