import { Footer } from "../components/footer/footer";
import { NavBar } from "../components/navbar/navbar";

export function HomePage() {
  return (
    <div className="min-h-screen bg-white flex-col">
      <NavBar />
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4">
        <div className="bg-[#f4f4f4] w-screen flex flex-col items-center">
          {/* Hero Content */}
          <div className="h-screen">
            <h1 className="text-7xl font-extrabold text-gray-900 mt-48 mb-8 underline decoration-[#F47D26]">
              DevTalk
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mb-4">
              Create or join forums, respond with messages and likes, and view AI-generated summaries.
              Sign in to get started!
            </p>
            <div className="flex flex-col md:flex-row gap-4 justify-center mb-12">
              <button
                className="px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold \
                hover:bg-[#F47D26] hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]\n                transition-all shadow will-change-transform m-2"
                onClick={() => {
                  window.location.href = "/create-forum";
                }}
              >
                Create Forum
              </button>
              <button
                className="px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold \
                hover:bg-[#F47D26] hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]\n                transition-all shadow will-change-transform m-2"            
                onClick={() => {
                  window.location.href = "/forums";
                }}
              >
                Browse Forums
              </button>
            </div>
          </div>
          {/* How We Work Section */}
          <div className="w-full mx-auto p-8 mt-4">
            <h2 className="text-5xl font-semibold mb-16 text-center text-gray-800">
              How We Work
            </h2>
            <div className="grid grid-cols-4 grid-flow-row gap-6">
              <div className="grid grid-cols-1 gap-3 border-gray-300 border-2 rounded-lg p-4 h-120 transition-all ">
                <span className="text-5xl text-[#F47D26]">1.</span>
                <div className="font-bold text-gray-800 mb-1 text-2xl">Create or Sign In</div>
                <div className="text-gray-600 text-lg">Create an account or sign in to your existing account.</div>
                <svg className="w-full h-full text-[#F47D26] mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1" />
                  <path stroke="currentColor" strokeWidth="1" d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                </svg>
              </div>
              <div className="grid grid-cols-1 gap-3 border-gray-300 border-2 rounded-lg p-4 h-120 transition-all ">
                <span className="text-5xl text-[#F47D26]">2.</span>
                <div className="font-bold text-gray-800 mb-1 text-2xl">Start or Join a Forum</div>
                <div className="text-gray-600 text-lg">Start or join a forum about any question or problem.</div>
                <svg className="w-full h-full text-[#F47D26] mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke="currentColor" strokeWidth="1" d="M8 10h8M8 14h4M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-4-.8L3 21l1.8-4A8.96 8.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="grid grid-cols-1 gap-3 border-gray-300 border-2 rounded-lg p-4 h-120 transition-all ">
                <span className="text-5xl text-[#F47D26]">3.</span>
                <div className="font-bold text-gray-800 mb-1 text-2xl">Engage & Upvote</div>
                <div className="text-gray-600 text-lg">Respond to messages and upvote or downvote responses.</div>
                <svg className="w-full h-full text-[#F47D26] mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke="currentColor" strokeWidth="1" d="M12 4l6 8H6l6-8zm0 16v-8" />
                </svg>
              </div>
              <div className="grid grid-cols-1 gap-3 border-gray-300 border-2 rounded-lg p-4 h-120 transition-all ">
                <span className="text-5xl text-[#F47D26]">4.</span>
                <div className="font-bold text-gray-800 mb-1 text-2xl">Read AI Summaries</div>
                <div className="text-gray-600 text-lg">Read AI-generated summaries of discussions after the forum ends.</div>
                <svg className="w-full h-full text-[#F47D26] mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.09a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
              </div>
            </div>
          </div>
          {/* Our Mission Section */}
          <section className="w-full max-w-4xl mx-auto mb-20">
            <h2 className="text-3xl font-bold text-gray-900 mb-8 font-sans text-center tracking-tight">
              Our Mission
            </h2>
            <p className="text-gray-600 text-center mt-8 max-w-2xl mx-auto">
              To empower communities to share knowledge, solve problems, and make decisions together—leveraging the power of AI to summarize and guide conversations.
            </p>
          </section>
          {/* Why Choose Us Section */}
          <section className="w-full max-w-4xl mx-auto mb-20">
            <h2 className="text-3xl font-bold text-gray-900 mb-8 font-sans text-center tracking-tight">
              Why Choose Us
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white rounded-lg shadow-md p-6 font-sans">
                <h3 className="text-xl font-semibold text-black mb-2">Trusted Technology</h3>
                <p className="text-gray-600">Built with industry-standard frameworks and cloud infrastructure for reliability and scalability.</p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6 font-sans">
                <h3 className="text-xl font-semibold text-black mb-2">AI-Powered Insights</h3>
                <p className="text-gray-600">Leverage advanced AI to summarize discussions and provide actionable roadmaps for your community.</p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6 font-sans">
                <h3 className="text-xl font-semibold text-black mb-2">Secure & Inclusive</h3>
                <p className="text-gray-600">User privacy, anonymous posting, and robust moderation tools ensure a safe and welcoming environment.</p>
              </div>
            </div>
          </section>
          {/* Meet the Team Section */}
          <section className="w-full max-w-4xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-8 font-sans text-center tracking-tight">
              Meet the Team
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {[
                { name: "Tyran", role: "Lead Full-Stack Developer" },
                { name: "Nicole", role: "Database Manager" },
                { name: "Devyn", role: "AI Full-Stack Engineer" },
                { name: "Jayden", role: "Product Manager" },
              ].map((member) => (
                <div key={member.name} className="bg-white rounded-lg shadow-md p-6 flex flex-col items-center font-sans">
                  <div className="w-20 h-20 bg-black rounded-full mb-4 flex items-center justify-center text-2xl font-bold" style={{ color: '#F47D26' }}>
                    {member.name[0]}
                  </div>
                  <div className="text-lg font-semibold text-gray-800 mb-1">{member.name}</div>
                  <div className="text-sm text-gray-500">{member.role}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
