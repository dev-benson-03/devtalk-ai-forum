import { signInWithEmailAndPassword } from "firebase/auth";
import React, { useState } from 'react';
import { Footer } from "../components/footer/footer";
import { firebaseAuth } from "../firebase";

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
  
  try {
    const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const user = userCredential.user;

    const adminUID = "g0035irux7MA70QfUOi3xb57bmg1";

    if (user.uid === adminUID) {
      // Admin user
      sessionStorage.setItem("role", "admin");
      sessionStorage.setItem("admin", "true");
      sessionStorage.setItem("anonymous", "false");
      alert("Admin logged in!");
    } else {
      // Regular signed-in user
      sessionStorage.setItem("role", "user");
      sessionStorage.setItem("admin", "false");
      sessionStorage.setItem("anonymous", "false");
      alert("User logged in!");
    }
          
    window.location.href = '/';

  } catch (err: any) {
    setError(err.message);
    console.error("Login error:", err);
  }
};
    
  return (
    <div className="min-h-screen bg-white flex-col">
      <div className="grid grid-cols-2 bg-[#f4f4f4]">
        <div>
          <img src="./DevTalkLogoSmallTanBG.png" alt="DevTalk Logo" className="h-full w-full object-cover p-16" />
        </div>  
        <div className="h-full m-16">
          <h2 className="text-8xl text-gray-800 font-bold mb-12 underline decoration-[#F47D26]"><em>Login</em></h2>
          <form onSubmit={handleSignIn}>
            <div className="w-2/3">
            </div>
            <div className="w-2/3">
              <label className="text-2xl text-gray-800 mt-2" htmlFor="email">Email: <span className="text-red-600">*</span></label>
              <input
                type="email"
                id="email"
                className="w-full border-gray-800 rounded px-3 py-2 border border-gray-300 my-4"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="w-2/3">
              <label className="text-2xl text-gray-800 mt-2" htmlFor="password">Password: <span className="text-red-600">*</span></label>
              <input
                type="password"
                id="password"
                className="w-full border-gray-800  rounded px-3 py-2 border border-gray-300 my-4"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="error-message">{error}</p>}
            <button className="mt-8 w-2/3 px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold 
            hover:bg-[#F47D26] hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]
            transition-all shadow will-change-transform" type="submit">Log In</button>
            </form>
            <div className="mt-4 text-gray-600">
              Don't have an account?{' '}
              <a className="text-blue-600 hover:underline" href="/signup">
                Sign Up
              </a>
            </div>
          </div>  
      </div>
    <Footer />
    </div>
  );
};
