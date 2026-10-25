import { verifyWebhook } from "@clerk/express/webhooks";
import { sql } from "../config/db.js";

export const handleClerkWebhook = async (req, res) => {
    let eventType;

    try {
        const evt = await verifyWebhook(req);

        eventType = evt.type;
        const data = evt.data;

        switch (eventType) {
            case "user.created": {
                const userId = data.id;

                const primaryEmail =
                    data.email_addresses?.find(
                        (email) => email.id === data.primary_email_address_id
                    )?.email_address ||
                    data.email_addresses?.[0]?.email_address ||
                    "";

                const name = `${data.first_name || "User"} ${data.last_name || ""}`.trim();
                const image = data.image_url || "";

                if (!primaryEmail) {
                    console.error("No email found for Clerk user:", userId);

                    return res.status(400).json({
                        success: false,
                        error: "No email found for Clerk user"
                    });
                }

                const result = await sql`
                    INSERT INTO users (id, name, email, image, plan)
                    VALUES (${userId}, ${name}, ${primaryEmail}, ${image}, 'free')
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        email = EXCLUDED.email,
                        image = EXCLUDED.image,
                        updated_at = NOW()
                    RETURNING id, name, email, image, plan, updated_at
                `;

                console.log("Clerk user created in Neon:", result[0]);
                break;
            }

            case "user.updated": {
                const userId = data.id;

                const primaryEmail =
                    data.email_addresses?.find(
                        (email) => email.id === data.primary_email_address_id
                    )?.email_address ||
                    data.email_addresses?.[0]?.email_address ||
                    "";

                const name = `${data.first_name || "User"} ${data.last_name || ""}`.trim();
                const image = data.image_url || "";

                if (!primaryEmail) {
                    console.error("No email found for Clerk user:", userId);

                    return res.status(400).json({
                        success: false,
                        error: "No email found for Clerk user"
                    });
                }

                const result = await sql`
                    UPDATE users
                    SET
                        name = ${name},
                        email = ${primaryEmail},
                        image = ${image},
                        updated_at = NOW()
                    WHERE id = ${userId}
                    RETURNING id, name, email, image, plan, updated_at
                `;

                if (result.length === 0) {
                    console.warn(
                        "No existing Neon user found for Clerk ID:",
                        userId
                    );

                    return res.status(200).json({
                        success: true,
                        eventType,
                        message: "User not found in Neon"
                    });
                }

                console.log("Clerk user updated in Neon:", result[0]);
                break;
            }

            case "user.deleted": {
                const userId = data.id;

                if (userId) {
                    const result = await sql`
                        DELETE FROM users
                        WHERE id = ${userId}
                        RETURNING id
                    `;

                    if (result.length > 0) {
                        console.log("Clerk user deleted from Neon:", userId);
                    } else {
                        console.warn("User not found for deletion:", userId);
                    }
                }

                break;
            }

            default:
                console.log("Unhandled Clerk webhook event type:", eventType);
        }

        return res.status(200).json({
            success: true,
            eventType
        });
    } catch (error) {
        console.error("Clerk webhook processing failed:", {
            eventType,
            message: error.message,
            code: error.code,
            detail: error.detail,
            constraint: error.constraint
        });

        return res.status(500).json({
            success: false,
            error: "Webhook processing failed"
        });
    }
};