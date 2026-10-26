
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth, useUser } from "@clerk/react";
import toast from "react-hot-toast";
import api from "../config/api";
import VideoGrid from "../components/meeting/VideoGrid";
import { useChat } from "../hooks/useChat";
import useWebRTC from "../hooks/useWebRTC";
import ChatPanel from "../components/meeting/ChatPanel";
import ParticipantList from "../components/meeting/ParticipantList";
import ControlBar from "../components/meeting/ControlBar";
import Loader from "../components/Loader";

const MeetingRoom = () => {
    const { meetingId } = useParams();
    const navigate = useNavigate();
    const { user } = useUser();
    const { getToken, isLoaded, isSignedIn } = useAuth();

    const [meeting, setMeeting] = useState(null);
    const [loadingMeeting, setLoadingMeeting] = useState(true);
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
    const [meetingValidated, setMeetingValidated] = useState(false);

    const userdata = useMemo(() => {
        if (!user) return null;

        return {
            id: user.id,
            name:
                user.fullName ||
                user.firstName ||
                user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
                "User",
            email: user.primaryEmailAddress?.emailAddress || "",
            image: user.imageUrl || "",
        };
    }, [user]);

    useEffect(() => {
        if (!isLoaded) return;

        if (!isSignedIn) {
            setLoadingMeeting(false);
            navigate("/dashboard");
            return;
        }

        let cancelled = false;

        const fetchMeeting = async () => {
            setLoadingMeeting(true);
            setMeetingValidated(false);

            try {
                if (!meetingId) {
                    throw new Error("Meeting ID is missing.");
                }

                const token = await getToken();

                if (!token) {
                    throw new Error("Authentication token unavailable. Please sign in again.");
                }

                const res = await api.get(
                    `/api/meetings/${encodeURIComponent(meetingId)}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                const meetingData = res.data?.meeting;

                if (!meetingData) {
                    throw new Error("Meeting details were not returned by the server.");
                }

                if (meetingData.status === "ended") {
                    throw new Error("This meeting has already ended.");
                }

                if (cancelled) return;

                setMeeting(meetingData);
                setMeetingValidated(true);
            } catch (error) {
                if (cancelled) return;

                console.error("Meeting fetch failed:", {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });

                const errorMsg =
                    error.response?.data?.error ||
                    error.message ||
                    "Unable to load meeting details.";

                toast.error(errorMsg);
                navigate("/dashboard");
            } finally {
                if (!cancelled) {
                    setLoadingMeeting(false);
                }
            }
        };

        fetchMeeting();

        return () => {
            cancelled = true;
        };
    }, [meetingId, getToken, isLoaded, isSignedIn, navigate]);

    const handleMeetingEnded = useCallback(() => {
        navigate("/dashboard");
    }, [navigate]);

    const {
        localStream,
        remoteUsers,
        audioEnabled,
        videoEnabled,
        toggleAudio,
        toggleVideo,
        endMeeting,
    } = useWebRTC(
        meetingValidated ? meetingId : null,
        meetingValidated ? userdata : null,
        handleMeetingEnded
    );

    const {
        messages,
        sendMessage,
        unreadCount,
        isChatOpen,
        toggleChat,
    } = useChat(
        meetingValidated ? meetingId : null,
        meetingValidated ? userdata : null
    );

    const hostId = meeting?.host?.id || meeting?.host_id || meeting?.host;

    const isHost = Boolean(
        userdata?.id &&
        hostId &&
        hostId.toString() === userdata.id.toString()
    );

    const handleLeave = () => {
        navigate("/dashboard");
    };

    const handleEndMeeting = async () => {
        if (!isHost) {
            toast.error("Only the meeting host can end this meeting.");
            return;
        }

        try {
            await endMeeting();
            toast.success("Meeting ended.");
            navigate("/dashboard");
        } catch (error) {
            console.error("Error ending meeting:", error);
            toast.error("Could not end the meeting.");
        }
    };

    if (loadingMeeting || !meetingValidated) {
        return <Loader text="Validating meeting..." />;
    }

    return (
        <div className="h-screen w-screen bg-slate-100 text-slate-900 flex flex-col overflow-hidden relative font-sans">
            <header className="w-full bg-white/90 backdrop-blur-md px-6 py-3 border-b border-slate-200 flex items-center justify-between z-30 shadow-xs">
                <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-slate-900 tracking-tight">
                        {meeting.title || meeting.name || "Meeting"} ({meetingId})
                    </h2>
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden relative">
                <VideoGrid
                    localStream={localStream}
                    localUser={userdata}
                    remoteUsers={remoteUsers}
                    audioEnabled={audioEnabled}
                    videoEnabled={videoEnabled}
                />

                <ChatPanel
                    isOpen={isChatOpen}
                    onClose={toggleChat}
                    messages={messages}
                    onSendMessage={sendMessage}
                    currentUser={userdata}
                />

                <ParticipantList
                    isOpen={isParticipantsOpen}
                    onClose={() => setIsParticipantsOpen(false)}
                    localUser={userdata}
                    localAudio={audioEnabled}
                    localVideo={videoEnabled}
                    remoteUsers={remoteUsers}
                    meetingHostId={hostId}
                />
            </div>

            <ControlBar
                roomId={meetingId}
                audioEnabled={audioEnabled}
                videoEnabled={videoEnabled}
                onToggleAudio={toggleAudio}
                onToggleVideo={toggleVideo}
                onToggleChat={toggleChat}
                onToggleParticipants={() =>
                    setIsParticipantsOpen((prev) => !prev)
                }
                isChatOpen={isChatOpen}
                isParticipantsOpen={isParticipantsOpen}
                unreadCount={unreadCount}
                participantCount={1 + remoteUsers.length}
                isHost={isHost}
                onLeave={handleLeave}
                onEndMeeting={handleEndMeeting}
            />
        </div>
    );
};

export default MeetingRoom;
