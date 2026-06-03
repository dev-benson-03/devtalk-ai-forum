import { onAuthStateChanged, type User } from "firebase/auth";
import { Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Footer } from "../components/footer/footer";
import { NavBar } from "../components/navbar/navbar";
import { firebaseAuth } from "../firebase";
import { useFirestore } from "../hooks/useFirestore";

export default function CreateForumPage() {
    const { createForum } = useFirestore();
    const [isLoading, setIsLoading] = useState(false);
    const [user, setCurrentUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        question: "",
        category: "",
        timeLimit: .083, // hours
    });

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // Calculate end time based on time limit (fractional hours supported)
            const endTime = new Date();
            endTime.setMinutes(endTime.getMinutes() + formData.timeLimit * 60);

            // Determine user identity
            let creatorId = user?.uid || "anonymous";
            let creatorName = "Anonymous User";
            if (typeof window !== "undefined") {
                const isAnonymous = window.sessionStorage.getItem("anonymous");
                if (isAnonymous === "false" && user) {
                    creatorName = user.displayName || user.email || "User";
                }
            }

            const forumData = {
                title: formData.title,
                description: formData.description,
                question: formData.question,
                creatorId,
                creatorName,
                endTime: Timestamp.fromDate(endTime),
                isActive: true,
                isAdminDeleted: false,
                tags: formData.category ? [formData.category] : [],
                messages: [""],
                summary: "",
                actionRoadmap: [""],
            };

            const forumId = await createForum(forumData);
            
            // Redirect to the forums page after successful creation
            window.location.href = '/forums';
        } catch (error) {
            console.error("Failed to create forum:", error);
            alert("Failed to create forum. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'timeLimit' ? parseFloat(value) : value
        }));
    };

    return (
        <div className="min-h-screen bg-white flex flex-col">
            <NavBar />

            <main className="flex-1 px-8 py-6">
                <div className="max-w-2xl mx-auto">
                    <h1 className="text-3xl font-bold text-gray-900 mb-8">Create New Forum</h1>
                    
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                                Forum Title: <span className="text-red-600">*</span>
                            </label>
                            <input
                                type="text"
                                id="title"
                                name="title"
                                required
                                value={formData.title}
                                onChange={handleInputChange}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent  "
                                placeholder="Enter a clear, descriptive title for your forum"
                            />
                        </div>

                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700  mb-2">
                                Description: <span className="text-red-600">*</span>
                            </label>
                            <textarea
                                id="description"
                                name="description"
                                required
                                value={formData.description}
                                onChange={handleInputChange}
                                rows={4}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent  "
                                placeholder="Provide a detailed description of what this forum is about"
                            />
                        </div>

                        <div>
                            <label htmlFor="question" className="block text-sm font-medium text-gray-700  mb-2">
                                Main Question: <span className="text-red-600">*</span>
                            </label>
                            <textarea
                                id="question"
                                name="question"
                                required
                                value={formData.question}
                                onChange={handleInputChange}
                                rows={3}
                                className="w-full px-4 py-2 border border-gray-300  rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent  "
                                placeholder="What specific question do you want the community to answer?"
                            />
                        </div>

                        <div>
                            <label htmlFor="category" className="block text-sm font-medium text-gray-700  mb-2">
                                Category: <span className="text-red-600">*</span>
                            </label>
                            <select
                                id="category"
                                name="category"
                                value={formData.category}
                                onChange={handleInputChange}
                                required
                                className="w-full px-4 py-2 border border-gray-300  rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent  "
                            >
                                <option value="">Select a category</option>
                                {categories.map(category => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="timeLimit" className="block text-sm font-medium text-gray-700  mb-2">
                                Time Limit: <span className="text-red-600">*</span>
                            </label>
                            <select
                                id="timeLimit"
                                name="timeLimit"
                                required
                                value={formData.timeLimit}
                                onChange={handleInputChange}
                                className="w-full px-4 py-2 border border-gray-300  rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent  "
                            >
                                <option value={0.083}>5 minutes</option>
                                <option value={0.25}>15 minutes</option>
                                <option value={0.5}>30 minutes</option>
                                <option value={1}>1 hour</option>
                                <option value={6}>6 hours</option>
                                <option value={12}>12 hours</option>
                                <option value={24}>24 hours (1 day)</option>
                                <option value={48}>48 hours (2 days)</option>
                                <option value={72}>72 hours (3 days)</option>
                                <option value={168}>1 week</option>
                            </select>
                            <p className="mt-1 text-sm text-gray-500 ">
                                The forum will automatically close after this time period
                            </p>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="flex-1 px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold \
                                hover:bg-[#F47D26] hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]\n                                transition-all shadow will-change-transform m-2 disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300"
                            >
                                {isLoading ? "Creating..." : "Create Forum"}
                            </button>
                            <button
                                type="button"
                                onClick={() => window.history.back()}
                                className="px-8 py-3 rounded-lg border-gray-800 border-2 text-gray-800 font-semibold \
                                hover:bg-red-600 hover:border-transparent hover:-translate-y-2 hover:text-white hover:shadow-[0_0_16px_4px_rgba(244,125,38,0.5)]\n                                transition-all shadow will-change-transform m-2"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </main>

            <Footer />
        </div>
    );
}

