import Slider from "../models/slider.model.js";
import {
  deleteCloudinaryImageBestEffort,
  uploadSliderImage,
} from "./cloudinary.service.js";

const MAX_SLIDER_IMAGE_BYTES = Number(
  process.env.SLIDER_IMAGE_MAX_BYTES || 2 * 1024 * 1024
);

const normalizeText = (value) => String(value || "").trim();

const normalizeOptionalUrl = (value, fieldName) => {
  const url = normalizeText(value);

  if (!url) return "";

  if (/^(https?:\/\/|[a-z][a-z\d+.-]*:\/\/|\/)/i.test(url)) {
    return url;
  }

  const error = new Error(`${fieldName} must be a valid URL, deep link, or app path`);
  error.statusCode = 400;
  throw error;
};

const parseBoolean = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const getBase64ByteLength = (imageBase64) => {
  const image = normalizeText(imageBase64);
  const base64 = image.includes(",") ? image.split(",").pop() : image;

  return Math.ceil((base64.length * 3) / 4);
};

const assertImageSize = (imageBase64) => {
  if (!imageBase64) return;

  if (getBase64ByteLength(imageBase64) > MAX_SLIDER_IMAGE_BYTES) {
    const error = new Error(
      `Slider image must not exceed ${Math.round(
        MAX_SLIDER_IMAGE_BYTES / (1024 * 1024)
      )}MB`
    );
    error.statusCode = 400;
    throw error;
  }
};

export const serializeSlider = (slider, { includeInactive = false } = {}) => ({
  id: slider._id,
  title: slider.title,
  imageUrl: slider.imageUrl,
  linkUrl: slider.linkUrl,
  isActive: includeInactive ? slider.isActive : undefined,
  sortOrder: includeInactive ? slider.sortOrder : undefined,
  createdAt: includeInactive ? slider.createdAt : undefined,
  updatedAt: includeInactive ? slider.updatedAt : undefined,
});

export const listPublicSliders = async () => {
  const sliders = await Slider.find({ isActive: true }).sort({
    sortOrder: 1,
    createdAt: -1,
  });

  return sliders.map((slider) => serializeSlider(slider));
};

export const listAdminSliders = async () => {
  const sliders = await Slider.find({}).sort({
    sortOrder: 1,
    createdAt: -1,
  });

  return sliders.map((slider) => serializeSlider(slider, { includeInactive: true }));
};

export const createSlider = async ({ payload, adminUserId }) => {
  const title = normalizeText(payload?.title);
  const linkUrl = normalizeOptionalUrl(payload?.linkUrl, "linkUrl");
  const sortOrder = Number(payload?.sortOrder || 0);
  const isActive = parseBoolean(payload?.isActive, true);
  let imageUrl = normalizeOptionalUrl(payload?.imageUrl, "imageUrl");
  let cloudinaryPublicId = "";

  if (payload?.imageBase64) {
    assertImageSize(payload.imageBase64);
    const uploaded = await uploadSliderImage(payload.imageBase64);
    imageUrl = uploaded.imageUrl;
    cloudinaryPublicId = uploaded.cloudinaryPublicId;
  }

  if (!imageUrl) {
    const error = new Error("imageBase64 or imageUrl is required");
    error.statusCode = 400;
    throw error;
  }

  const slider = await Slider.create({
    title,
    imageUrl,
    cloudinaryPublicId,
    linkUrl,
    isActive,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    updatedBy: adminUserId,
  });

  return serializeSlider(slider, { includeInactive: true });
};

export const updateSlider = async ({ sliderId, payload, adminUserId }) => {
  const slider = await Slider.findById(sliderId);

  if (!slider) {
    const error = new Error("Slider was not found");
    error.statusCode = 404;
    throw error;
  }

  const previousCloudinaryPublicId = slider.cloudinaryPublicId;

  if (payload?.title !== undefined) slider.title = normalizeText(payload.title);
  if (payload?.linkUrl !== undefined) {
    slider.linkUrl = normalizeOptionalUrl(payload.linkUrl, "linkUrl");
  }
  if (payload?.isActive !== undefined) {
    slider.isActive = parseBoolean(payload.isActive, slider.isActive);
  }
  if (payload?.sortOrder !== undefined) {
    const sortOrder = Number(payload.sortOrder);

    if (!Number.isFinite(sortOrder)) {
      const error = new Error("sortOrder must be a number");
      error.statusCode = 400;
      throw error;
    }

    slider.sortOrder = sortOrder;
  }
  if (payload?.imageUrl !== undefined) {
    slider.imageUrl = normalizeOptionalUrl(payload.imageUrl, "imageUrl");
    slider.cloudinaryPublicId = "";
  }
  if (payload?.imageBase64) {
    assertImageSize(payload.imageBase64);
    const uploaded = await uploadSliderImage(payload.imageBase64);
    slider.imageUrl = uploaded.imageUrl;
    slider.cloudinaryPublicId = uploaded.cloudinaryPublicId;
  }

  if (!slider.imageUrl) {
    const error = new Error("Slider imageUrl cannot be empty");
    error.statusCode = 400;
    throw error;
  }

  slider.updatedBy = adminUserId;
  await slider.save();

  if (
    previousCloudinaryPublicId &&
    previousCloudinaryPublicId !== slider.cloudinaryPublicId
  ) {
    deleteCloudinaryImageBestEffort(previousCloudinaryPublicId);
  }

  return serializeSlider(slider, { includeInactive: true });
};

export const deleteSlider = async (sliderId) => {
  const slider = await Slider.findById(sliderId);

  if (!slider) {
    const error = new Error("Slider was not found");
    error.statusCode = 404;
    throw error;
  }

  await slider.deleteOne();
  deleteCloudinaryImageBestEffort(slider.cloudinaryPublicId);

  return serializeSlider(slider, { includeInactive: true });
};
