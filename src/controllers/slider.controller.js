import {
  createSlider,
  deleteSlider,
  listAdminSliders,
  listPublicSliders,
  updateSlider,
} from "../services/slider.service.js";

const sendSliderError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const getSliders = async (req, res) => {
  try {
    const sliders = await listPublicSliders();

    res.json({
      sliders,
      count: sliders.length,
    });
  } catch (error) {
    sendSliderError(res, "Could not fetch sliders", error);
  }
};

export const getAdminSliders = async (req, res) => {
  try {
    const sliders = await listAdminSliders();

    res.json({
      sliders,
      count: sliders.length,
    });
  } catch (error) {
    sendSliderError(res, "Could not fetch admin sliders", error);
  }
};

export const createAdminSlider = async (req, res) => {
  try {
    const slider = await createSlider({
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.status(201).json({
      message: "Slider created successfully",
      slider,
    });
  } catch (error) {
    sendSliderError(res, "Could not create slider", error);
  }
};

export const updateAdminSlider = async (req, res) => {
  try {
    const slider = await updateSlider({
      sliderId: req.params.sliderId,
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.json({
      message: "Slider updated successfully",
      slider,
    });
  } catch (error) {
    sendSliderError(res, "Could not update slider", error);
  }
};

export const deleteAdminSlider = async (req, res) => {
  try {
    const slider = await deleteSlider(req.params.sliderId);

    res.json({
      message: "Slider deleted successfully",
      slider,
    });
  } catch (error) {
    sendSliderError(res, "Could not delete slider", error);
  }
};
