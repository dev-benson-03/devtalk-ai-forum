import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "../../firebase";

export function NavBar() {
  const [isAnonymous, setAnonymous] = useState<string>("");
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Set up auth state listener once on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      if (user) {
        // Optionally, update anonymous state here if needed
        if (typeof window !== "undefined") {
          const savedAnonymous = window.sessionStorage.getItem("anonymous");
          if (savedAnonymous !== null) {
            setAnonymous(savedAnonymous);
            console.log("Anonymous User: " + savedAnonymous);
          }
        }
      } else {
        setAnonymous("");
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <nav className="flex items-center justify-between px-8 border-b border-gray-200 h-32">
      <div className="flex items-center gap-3">
        <button className="ml-2 text-2xl font-bold text-gray-800"
          onClick={() => {
            window.location.href = "/";
          }}>
          <img src="./DevTalkLogoSmall.png" alt="DevTalk Logo" className="w-48 inline-block mr-2"/>
        </button>
      </div>
      {currentUser !== null ? (
        <button
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gray-100 text-gray-800 font-semibold hover:bg-gray-200 transition-colors shadow"
          onClick={() => {
            window.location.href = "/userdashboard";
          }}
        >
          {/* Simple profile SVG icon */}
          <span>{isAnonymous === "false" ? currentUser?.displayName : "Anonymous User"}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 1115 0v.75a.75.75 0 01-.75.75h-13.5a.75.75 0 01-.75-.75v-.75z" />
          </svg>
        </button>
      ) : (
        <button
          className="px-10 py-3 rounded-lg bg-[#F47D26] text-white font-semibold hover:bg-[#f7a163] transition-colors shadow"
          onClick={() => {
            window.location.href = "/login";
          }}
        >
          Log In
        </button>
      )}
    </nav>
  );
}
