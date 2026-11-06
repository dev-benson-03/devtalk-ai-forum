import { onIdTokenChanged, signOut } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { Footer } from '~/components/footer/footer';
import { NavBar } from '~/components/navbar/navbar';
import { hasAdminClaim } from '../auth/admin-claim';
import { firebaseAuth } from '../firebase';

export const UserDashboardPage: React.FC = () => {
  // Admin view only for a verified `admin` custom claim on the ID token
  const [isAdmin, setAdmin] = useState<boolean>(false);
  const [isAnonymous, setAnonymous] = useState<string>("");
  const [user, setCurrentUser] = useState<any>(null);

  // Function to toggle the anonymous display preference (not an authorization setting)
  const toggleUserSetting = () => {
    if(isAnonymous === "false") {
      sessionStorage.setItem("anonymous", "true");
      setAnonymous("true");

    }
    else {
      sessionStorage.setItem("anonymous", "false");
      setAnonymous("false")
    }
    
  };

  // Follows sign-in, sign-out and token refreshes, so a granted or revoked
  // claim shows up once the token is refreshed
  useEffect(() => {
      let current = true;
      const unsubscribe = onIdTokenChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      if (!user) {
          setAdmin(false);
          // User is redirected to login page
          window.location.href = '/login';
          return;
      }
      hasAdminClaim(user).then((admin) => {
          if (current) setAdmin(admin);
      });
      });
      return () => {
          current = false;
          unsubscribe();
      };
  }, []);

    // Load the display preference from sessionStorage (client-side only)
    useEffect(() => {
      if (typeof window !== "undefined") {
        const savedAnonymous = window.sessionStorage.getItem("anonymous");
        if (savedAnonymous !== null) {
          setAnonymous(savedAnonymous);
        }
      }
    }, );
  
    // Function to log out the user
    const handleLogout = async () => {
      await signOut(firebaseAuth);
      sessionStorage.clear();
      window.location.href = '/login';
    };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <NavBar />
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="bg-white shadow-lg rounded-lg p-10 w-full max-w-md">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">User Settings</h1>
          {/* Conditionally render content based on isAdmin state */}
          {isAdmin ? (
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2 text-[#F47D26]">Admin View</h2>
              <p className="text-gray-700 mb-4">You can edit or delete.</p>
              <button
                onClick={handleLogout}
                className="mt-6 px-6 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow"
              >
                Log Out
              </button>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2 text-[#F47D26]">User View</h2>
              <p className="text-gray-700 mb-4">
                {isAnonymous === "true"
                  ? "You are browsing anonymously."
                  : "Your identity is visible to others."}
              </p>
              <button
                onClick={toggleUserSetting}
                className="px-6 py-2 rounded-lg bg-[#F47D26] text-white font-semibold hover:bg-[#f7a163] transition-colors shadow mr-4"
              >
                {isAnonymous === "true" ? "Go Visible" : "Go Anonymous"}
              </button>
              <button
                onClick={handleLogout}
                className="px-6 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow"
              >
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};
