import crypto from "crypto";

const CLOUDINARY_API_BASE = "https://api.cloudinary.com/v1_1";
const DEFAULT_UPLOAD_FOLDER = "billxpress/sliders";

const getCloudinaryConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Cloudinary is not configured");
    error.statusCode = 500;
    throw error;
  }

  return { cloudName, apiKey, apiSecret };
};

const signCloudinaryParams = (params, apiSecret) => {
  const signaturePayload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${signaturePayload}${apiSecret}`)
    .digest("hex");
};

const normalizeImageData = (imageBase64) => {
  const image = String(imageBase64 || "").trim();

  if (!image) {
    const error = new Error("Slider image is required");
    error.statusCode = 400;
    throw error;
  }

  if (image.startsWith("data:image/")) {
    return image;
  }

  return `data:image/jpeg;base64,${image}`;
};

export const uploadSliderImage = async (imageBase64) => {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: process.env.CLOUDINARY_SLIDER_FOLDER || DEFAULT_UPLOAD_FOLDER,
    timestamp,
  };
  const formData = new FormData();

  formData.append("file", normalizeImageData(imageBase64));
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", params.folder);
  formData.append("signature", signCloudinaryParams(params, apiSecret));

  const response = await fetch(
    `${CLOUDINARY_API_BASE}/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error?.message || "Cloudinary upload failed");
    error.statusCode = 502;
    error.providerResponse = body;
    throw error;
  }

  return {
    imageUrl: body.secure_url,
    cloudinaryPublicId: body.public_id,
    raw: body,
  };
};

export const deleteCloudinaryImageBestEffort = async (publicId) => {
  if (!publicId) return null;

  try {
    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      public_id: publicId,
      timestamp,
    };
    const formData = new FormData();

    formData.append("public_id", publicId);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("signature", signCloudinaryParams(params, apiSecret));

    const response = await fetch(
      `${CLOUDINARY_API_BASE}/${cloudName}/image/destroy`,
      {
        method: "POST",
        body: formData,
      }
    );

    return response.json().catch(() => null);
  } catch (error) {
    console.error("Could not delete Cloudinary slider image", error.message);
    return null;
  }
};
