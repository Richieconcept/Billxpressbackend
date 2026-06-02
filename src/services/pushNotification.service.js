const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export const sendExpoPushNotifications = async ({ tokens, title, message, data = {} }) => {
  const activeTokens = [...new Set((tokens || []).filter(Boolean))];

  if (activeTokens.length === 0) {
    return {
      attempted: false,
      successful: false,
      count: 0,
      error: "No active device tokens",
    };
  }

  const chunks = [];
  for (let index = 0; index < activeTokens.length; index += 100) {
    chunks.push(activeTokens.slice(index, index + 100));
  }

  try {
    const responses = [];

    for (const chunk of chunks) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(
          chunk.map((token) => ({
            to: token,
            title,
            body: message,
            data,
            sound: "default",
          }))
        ),
      });
      const result = await response.json().catch(() => ({}));
      responses.push(result);

      if (!response.ok) {
        throw new Error(result.message || "Expo push request failed");
      }
    }

    return {
      attempted: true,
      successful: true,
      count: activeTokens.length,
      responses,
    };
  } catch (error) {
    return {
      attempted: true,
      successful: false,
      count: activeTokens.length,
      error: error.message,
    };
  }
};
