import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { FaCheckCircle, FaList, FaTag, FaTimesCircle } from 'react-icons/fa';
import { Link } from "react-router";
import { Footer } from "../components/footer/footer";
import { NavBar } from "../components/navbar/navbar";
import { firebaseAuth } from "../firebase";
import { useForums } from "../hooks/useFirestore";

export function ForumsPage() {
  const { forums, loading, error } = useForums();
  const [user, setCurrentUser] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");

  // Predefined categories (can be replaced with dynamic extraction)
  const categories = [
      "Technology",
      "Programming", 
      "Career Advice",
      "Education",
      "AI/Machine Learning",
      "Web Development",
      "Mobile Development",
      "General Discussion",
      "Other"
  ];

  // Set up auth state listener once on mount
  useEffect(() => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      if (!user) {
          // User is redirected to login page
          window.location.href = '/login';
      }
      });
      return () => unsubscribe();
  }, []);

  // Filter forums based on selected filters
  const filteredForums = forums.filter(forum => {
    const endTime = forum.endTime?.toDate();
    const isExpired = endTime && new Date() > endTime;
    const status = isExpired ? "Closed" : "Open";
    const matchesCategory = selectedCategory === "All" || (forum.tags && forum.tags.includes(selectedCategory));
    const matchesStatus = selectedStatus === "All" || status === selectedStatus;
    return matchesCategory && matchesStatus;
  });

  // Sort forums so open forums appear first
  const sortedForums = [...filteredForums].sort((a, b) => {
    const aEnd = a.endTime?.toDate();
    const bEnd = b.endTime?.toDate();
    const aExpired = aEnd && new Date() > aEnd;
    const bExpired = bEnd && new Date() > bEnd;
    if (aExpired === bExpired) return 0;
    return aExpired ? 1 : -1;
  });

  // Handler for radio button toggle (allows deselect)
  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(prev => prev === cat ? "All" : cat);
  };
  const handleStatusChange = (status: string) => {
    setSelectedStatus(prev => prev === status ? "All" : status);
  };
  const clearFilters = () => {
    setSelectedCategory("All");
    setSelectedStatus("All");
  };

  // Helper to get an icon for each category
  const getCategoryIcon = (cat: string) => {
    // You can customize icons for specific categories here
    return <FaTag className="w-5 h-5 mr-2" />;
  };
  const getStatusIcon = (status: string) => {
    return status === 'Open' ? <FaCheckCircle className="w-5 h-5 mr-2 text-green-500" /> : <FaTimesCircle className="w-5 h-5 mr-2 text-gray-400" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <NavBar />
        <main className="bg-[#f4f4f4]flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading forums...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <NavBar />
        <main className="bg-[#f4f4f4] flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Retry
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="bg-[#f4f4f4] flex-1 px-8 py-6">
        <div className="max-w-full flex gap-8 mr-12">
          {/* Filter Sidebar (far left) */}
          <aside className="w-80 bg-gray-50 border border-gray-200 rounded-xl shadow p-6 h-fit sticky top-24 self-start flex-shrink-0">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">Filter Forums</h2>
              <button
                className="text-xs text-blue-600 hover:underline font-semibold"
                onClick={clearFilters}
                type="button"
              >
                Clear Filters
              </button>
            </div>
            <div className="mb-6">
              <div className="block text-sm font-medium text-gray-700 mb-2">Category</div>
              <div className="flex flex-col gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    className="hidden"
                    checked={selectedCategory === "All"}
                    onChange={() => setSelectedCategory("All")}
                  />
                  <span
                    className={`flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold ${selectedCategory === "All" ? "bg-blue-600 text-white border-blue-600" : "bg-transparent text-gray-700 border-gray-300 hover:border-blue-400"}`}
                    onClick={() => setSelectedCategory("All")}
                  >
                    <FaList className="w-5 h-5 mr-2" /> All
                  </span>
                </label>
                {categories.map(cat => (
                  <label key={cat} className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      className="hidden"
                      checked={selectedCategory === cat}
                      onChange={() => handleCategoryChange(cat)}
                    />
                    <span
                      className={`flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold ${selectedCategory === cat ? "bg-blue-600 text-white border-blue-600" : "bg-transparent text-gray-700 border-gray-300 hover:border-blue-400"}`}
                      onClick={() => handleCategoryChange(cat)}
                    >
                      {getCategoryIcon(cat)} {cat}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="block text-sm font-medium text-gray-700 mb-2">Status</div>
              <div className="flex flex-col gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    className="hidden"
                    checked={selectedStatus === "All"}
                    onChange={() => setSelectedStatus("All")}
                  />
                  <span
                    className={`flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold ${selectedStatus === "All" ? "bg-blue-600 text-white border-blue-600" : "bg-transparent text-gray-700 border-gray-300 hover:border-blue-400"}`}
                    onClick={() => setSelectedStatus("All")}
                  >
                    <FaList className="w-5 h-5 mr-2" /> All
                  </span>
                </label>
                {['Open', 'Closed'].map(status => (
                  <label key={status} className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      className="hidden"
                      checked={selectedStatus === status}
                      onChange={() => handleStatusChange(status)}
                    />
                    <span
                      className={`flex items-center w-full px-4 py-1 rounded-lg transition-colors text-base font-semibold ${selectedStatus === status ? (status === 'Open' ? "bg-green-600 text-white border-green-600" : "bg-gray-600 text-white border-gray-600") : "bg-transparent text-gray-700 border-gray-300 hover:border-blue-400"}`}
                      onClick={() => handleStatusChange(status)}
                    >
                      {getStatusIcon(status)} {status}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
          {/* Forums List */}
          <div className="flex-1">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Discussion Forums</h1>
              <Link
                to="/create-forum"
                className="px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold \
                hover:bg-[#F47D26] hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]\n                transition-all shadow will-change-transform m-2"
              >
                Create Forum
              </Link>
            </div>
            {sortedForums.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No forums found</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">Try adjusting your filters or create a new forum!</p>
                <Link
                  to="/create-forum"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  Create Your First Forum
                </Link>
              </div>
            ) : (
              <ul className="space-y-6">
                {sortedForums.map((forum) => {
                  const createdAt = forum.createdAt?.toDate();
                  const endTime = forum.endTime?.toDate();
                  const isExpired = endTime && new Date() > endTime;
                  const status = isExpired ? "Closed" : "Open";
                  return (
                    <li key={forum.id}>
                      <Link
                        to={`/forum/${forum.id}`}
                        className="block rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow hover:shadow-lg transition-all hover:scale-[1.02]"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <h2 className="text-xl font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                            {forum.title}
                          </h2>
                          <div className="flex flex-col items-end gap-2">
                            <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                              status === "Open" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                            }`}>
                              {status}
                            </span>
                            {forum.tags && forum.tags.length > 0 && (
                              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                {forum.tags[0]}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300 mb-3 line-clamp-2">
                          {forum.description}
                        </p>
                        <div className="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
                          <div>
                            By {forum.creatorName} • {createdAt ? createdAt.toLocaleDateString() : 'Unknown date'}
                          </div>
                          <div className="flex gap-4">
                            <span>{forum.commentCount || 0} responses</span>
                            <span>↑ {forum.upvotes || 0}</span>
                            <span>↓ {forum.downvotes || 0}</span>
                          </div>
                        </div>
                        {forum.endTime && (
                          <div className="mt-2 text-xs text-gray-400">
                            {isExpired ? 'Closed' : 'Closes'} on {endTime ? endTime.toLocaleDateString() : ''} at {endTime ? endTime.toLocaleTimeString() : ''}
                          </div>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
    );
  }