
import { sql } from "./config/db.js";

const rooms = new Map();

export function setupSocketIO(io) {
    io.on("connection", (socket) => {
        let currentRoomId = null;
        let currentUser = null;

        const isRoomParticipant = (roomId) => {
            return Boolean(
                roomId &&
                currentRoomId === roomId &&
                rooms.has(roomId) &&
                rooms.get(roomId).has(socket.id)
            );
        };

        socket.on("join-room", async ({
            roomId,
            user,
            audioEnabled = true,
            videoEnabled = true,
        } = {}) => {
            try {
                if (!roomId || !user?.id) {
                    socket.emit("meeting-ended", {
                        message: "Invalid room or user information.",
                    });
                    return;
                }

                if (currentRoomId) {
                    socket.emit("meeting-ended", {
                        message: "You have already joined a meeting room.",
                    });
                    return;
                }

                const meetings = await sql`
                    SELECT id, meeting_id, host_id, status
                    FROM meetings
                    WHERE meeting_id = ${roomId}
                    LIMIT 1
                `;

                if (meetings.length === 0) {
                    socket.emit("meeting-ended", {
                        message: "Meeting not found.",
                    });
                    return;
                }

                const meeting = meetings[0];

                if (meeting.status === "ended") {
                    socket.emit("meeting-ended", {
                        message: "This meeting has already ended.",
                    });
                    return;
                }

                const hostId = meeting.host_id?.toString();
                const isHost = Boolean(
                    hostId && hostId === user.id.toString()
                );

                const hosts = await sql`
                    SELECT plan
                    FROM users
                    WHERE id = ${meeting.host_id}
                    LIMIT 1
                `;

                const hostPlan = hosts[0]?.plan || "free";
                const maxParticipants =
                    hostPlan === "premium" ? 100 : 10;

                if (!rooms.has(roomId)) {
                    rooms.set(roomId, new Map());
                }

                const roomParticipants = rooms.get(roomId);

                if (roomParticipants.size >= maxParticipants) {
                    socket.emit("meeting-ended", {
                        message: `Meeting capacity limit reached. Maximum participants: ${maxParticipants}.`,
                    });

                    if (roomParticipants.size === 0) {
                        rooms.delete(roomId);
                    }

                    return;
                }

                const participantName = user.name || "Anonymous";
                const userId = user.id;

                const existingParticipants = await sql`
                    SELECT id
                    FROM meeting_participants
                    WHERE meeting_id = ${meeting.id}
                    AND (
                        user_id = ${userId}
                        OR name = ${participantName}
                    )
                    LIMIT 1
                `;

                if (existingParticipants.length === 0) {
                    await sql`
                        INSERT INTO meeting_participants
                            (meeting_id, user_id, name, joined_at)
                        VALUES (
                            ${meeting.id},
                            ${userId},
                            ${participantName},
                            NOW()
                        )
                    `;
                }

                currentUser = {
                    socketId: socket.id,
                    userId,
                    userName: participantName,
                    isHost,
                    audioEnabled,
                    videoEnabled,
                };

                currentRoomId = roomId;

                const existingUsers = Array.from(
                    roomParticipants.values()
                );

                roomParticipants.set(socket.id, currentUser);

                socket.join(roomId);

                socket.emit("all-users", existingUsers);

                socket.to(roomId).emit("user-joined", currentUser);
            } catch (error) {
                console.error("Error joining room in socket:", error);

                socket.emit("meeting-ended", {
                    message: "Failed to join room. Please try again.",
                });

                if (currentRoomId && rooms.has(currentRoomId)) {
                    rooms.get(currentRoomId).delete(socket.id);
                    socket.leave(currentRoomId);

                    if (rooms.get(currentRoomId).size === 0) {
                        rooms.delete(currentRoomId);
                    }
                }

                currentRoomId = null;
                currentUser = null;
            }
        });

        socket.on(
            "offer",
            ({ targetSocketId, callerSocketId, sdp } = {}) => {
                if (!currentRoomId || !isRoomParticipant(currentRoomId)) {
                    return;
                }

                if (
                    !targetSocketId ||
                    !sdp ||
                    callerSocketId !== socket.id
                ) {
                    return;
                }

                const participants = rooms.get(currentRoomId);

                if (!participants?.has(targetSocketId)) {
                    return;
                }

                io.to(targetSocketId).emit("offer", {
                    callerSocketId: socket.id,
                    sdp,
                    callerUser: currentUser,
                });
            }
        );

        socket.on(
            "answer",
            ({ targetSocketId, responderSocketId, sdp } = {}) => {
                if (!currentRoomId || !isRoomParticipant(currentRoomId)) {
                    return;
                }

                if (
                    !targetSocketId ||
                    !sdp ||
                    responderSocketId !== socket.id
                ) {
                    return;
                }

                const participants = rooms.get(currentRoomId);

                if (!participants?.has(targetSocketId)) {
                    return;
                }

                io.to(targetSocketId).emit("answer", {
                    responderSocketId: socket.id,
                    sdp,
                    responderUser: currentUser,
                });
            }
        );

        socket.on(
            "ice-candidate",
            ({ targetSocketId, senderSocketId, candidate } = {}) => {
                if (!currentRoomId || !isRoomParticipant(currentRoomId)) {
                    return;
                }

                if (
                    !targetSocketId ||
                    !candidate ||
                    senderSocketId !== socket.id
                ) {
                    return;
                }

                const participants = rooms.get(currentRoomId);

                if (!participants?.has(targetSocketId)) {
                    return;
                }

                io.to(targetSocketId).emit("ice-candidate", {
                    senderSocketId: socket.id,
                    candidate,
                });
            }
        );

        socket.on("toggle-audio", ({ roomId, audioEnabled } = {}) => {
            if (
                roomId !== currentRoomId ||
                typeof audioEnabled !== "boolean" ||
                !isRoomParticipant(roomId)
            ) {
                return;
            }

            const participant = rooms.get(roomId).get(socket.id);
            participant.audioEnabled = audioEnabled;

            socket.to(roomId).emit("user-toggled-audio", {
                socketId: socket.id,
                audioEnabled,
            });
        });

        socket.on("toggle-video", ({ roomId, videoEnabled } = {}) => {
            if (
                roomId !== currentRoomId ||
                typeof videoEnabled !== "boolean" ||
                !isRoomParticipant(roomId)
            ) {
                return;
            }

            const participant = rooms.get(roomId).get(socket.id);
            participant.videoEnabled = videoEnabled;

            socket.to(roomId).emit("user-toggled-video", {
                socketId: socket.id,
                videoEnabled,
            });
        });

        socket.on("send-message", async ({ roomId, message } = {}) => {
            try {
                if (
                    roomId !== currentRoomId ||
                    !isRoomParticipant(roomId) ||
                    !message ||
                    typeof message.text !== "string" ||
                    !message.text.trim()
                ) {
                    return;
                }

                const meetings = await sql`
                    SELECT id, status
                    FROM meetings
                    WHERE meeting_id = ${roomId}
                    LIMIT 1
                `;

                if (
                    meetings.length === 0 ||
                    meetings[0].status === "ended"
                ) {
                    socket.emit("meeting-ended", {
                        message: "This meeting has ended.",
                    });
                    return;
                }

                const meetingId = meetings[0].id;
                const senderName = currentUser.userName;
                const text = message.text.trim();

                await sql`
                    INSERT INTO meeting_messages
                        (meeting_id, sender_id, sender_name, text, timestamp)
                    VALUES (
                        ${meetingId},
                        ${currentUser.userId},
                        ${senderName},
                        ${text},
                        NOW()
                    )
                `;

                io.to(roomId).emit("receive-message", {
                    ...message,
                    senderId: currentUser.userId,
                    senderName,
                    text,
                    senderSocketId: socket.id,
                });
            } catch (error) {
                console.error("Error sending message:", error);
            }
        });

        socket.on("end-meeting", async ({ roomId } = {}) => {
            try {
                if (
                    roomId !== currentRoomId ||
                    !isRoomParticipant(roomId) ||
                    !currentUser?.isHost
                ) {
                    socket.emit("meeting-action-error", {
                        message: "Only the meeting host can end this meeting.",
                    });
                    return;
                }

                const result = await sql`
                    UPDATE meetings
                    SET status = 'ended', ended_at = NOW()
                    WHERE meeting_id = ${roomId}
                    AND host_id = ${currentUser.userId}
                    AND status <> 'ended'
                    RETURNING id
                `;

                if (result.length === 0) {
                    socket.emit("meeting-action-error", {
                        message: "Meeting not found or already ended.",
                    });
                    return;
                }

                io.to(roomId).emit("meeting-ended", {
                    message: "The meeting has been ended by the host.",
                });

                const participants = rooms.get(roomId);

                if (participants) {
                    for (const socketId of participants.keys()) {
                        const participantSocket = io.sockets.sockets.get(
                            socketId
                        );

                        if (participantSocket) {
                            participantSocket.leave(roomId);
                        }
                    }
                }

                rooms.delete(roomId);
            } catch (error) {
                console.error("Error ending meeting:", error);

                socket.emit("meeting-action-error", {
                    message: "Could not end the meeting. Please try again.",
                });
            }
        });

        socket.on("disconnect", () => {
            if (!currentRoomId || !rooms.has(currentRoomId)) {
                return;
            }

            const roomId = currentRoomId;
            const roomParticipants = rooms.get(roomId);

            roomParticipants.delete(socket.id);

            if (roomParticipants.size === 0) {
                rooms.delete(roomId);
            } else {
                socket.to(roomId).emit("user-left", {
                    socketId: socket.id,
                    user: currentUser,
                });
            }

            currentRoomId = null;
            currentUser = null;
        });
    });
}
