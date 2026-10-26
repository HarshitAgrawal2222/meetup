import * as apiModule from "../config/api";
console.log("module:", apiModule, "default:", apiModule.default);
import React, { useEffect, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/react";
import toast from "react-hot-toast";
import api from "../config/api";
import EmptySessions from "../components/sessions/EmptySessions";
import SessionCard from "../components/sessions/SessionCard";
import SessionDetailModal from "../components/sessions/SessionDetailModel";
import Loader from "../components/Loader";

const Sessions = () => {
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();
    const { isLoaded, isSignedIn, getToken } = useAuth();

    useEffect(() => {
        if (!isLoaded) return;

        if (!isSignedIn) {
            setLoading(false);
            navigate("/dashboard");
            return;
        }

        let cancelled = false;

        const fetchSessions = async () => {
            setLoading(true);

            try {
                const token = await getToken();

                if (!token) {
                    throw new Error("Authentication token unavailable.");
                }
                console.log("API instance:", api);
                console.log("API get method:", api?.get);
                const response = await api.get(
                    "/api/meetings/sessions",
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (cancelled) return;

                setSessions(response.data.meetings || []);
            } catch (error) {
                if (cancelled) return;

                console.error("Failed to load sessions:", {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });

                toast.error(
                    error.response?.data?.error ||
                    error.message ||
                    "Failed to load meeting sessions"
                );
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchSessions();

        return () => {
            cancelled = true;
        };
    }, [isLoaded, isSignedIn, getToken, navigate]);

    const openSessionDetails = async (sessionId) => {
        try {
            const token = await getToken();

            if (!token) {
                toast.error("Please sign in again.");
                return;
            }

            const response = await api.get(
                `/api/meetings/sessions/${encodeURIComponent(sessionId)}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            setSelectedSession(response.data.meeting);
        } catch (error) {
            console.error("Failed to fetch session details:", {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message,
            });

            toast.error(
                error.response?.data?.error ||
                "Could not fetch session details"
            );
        }
    };

    const handleRejoin = (meetingId) => {
        if (!meetingId) {
            toast.error("Meeting ID is missing.");
            return;
        }

        navigate(`/meeting/${encodeURIComponent(meetingId)}`);
    };

    if (!isLoaded || loading) {
        return <Loader text="Loading meeting history..." />;
    }

    return (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-12">
            <Link
                to="/dashboard"
                className="flex items-center text-sm gap-1 mb-4 text-slate-500 hover:text-slate-900 transition-colors"
            >
                <ArrowLeftIcon size={14} />
                Go to Dashboard
            </Link>

            <div className="mb-8">
                <h1 className="text-3xl font-medium tracking-tight text-slate-900">
                    Meeting sessions.
                </h1>

                <p className="text-sm text-slate-500 mt-1">
                    Review your past and active meeting history,
                    participant logs, and chat transcripts.
                </p>
            </div>

            {sessions.length === 0 ? (
                <EmptySessions />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sessions.map((session) => (
                        <SessionCard
                            key={session.id}
                            session={session}
                            onOpenDetails={() =>
                                openSessionDetails(session.id)
                            }
                            onRejoin={handleRejoin}
                        />
                    ))}
                </div>
            )}

            <SessionDetailModal
                session={selectedSession}
                onClose={() => setSelectedSession(null)}
            />
        </main>
    );
};

export default Sessions;
