import express from "express";
import {
  createCard,
  freezeCard,
  fundCard,
  getCard,
  getCardConfiguration,
  getCards,
  getCardTransactions,
  payCardMaintenance,
  quoteCardCreation,
  quoteCardFunding,
  quoteCardWithdrawal,
  unfreezeCard,
  withdrawCard,
} from "../controllers/card.controller.js";
import {
  protect,
  requireAuthTier,
  requireVerifiedEmail,
} from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const cardAccess = [protect, requireVerifiedEmail, requireAuthTier("tier_3")];
const cardQuoteLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Too many card quote requests, please try again shortly",
});
const cardActionLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another card request was just submitted, please wait a moment",
});

router.get("/configuration", ...cardAccess, getCardConfiguration);
router.get("/", ...cardAccess, getCards);
router.post("/creation-quote", ...cardAccess, cardQuoteLimiter, quoteCardCreation);
router.post("/", ...cardAccess, cardActionLimiter, createCard);
router.get("/:cardId", ...cardAccess, getCard);
router.post("/:cardId/funding-quote", ...cardAccess, cardQuoteLimiter, quoteCardFunding);
router.post("/:cardId/fund", ...cardAccess, cardActionLimiter, fundCard);
router.post(
  "/:cardId/withdrawal-quote",
  ...cardAccess,
  cardQuoteLimiter,
  quoteCardWithdrawal
);
router.post("/:cardId/withdraw", ...cardAccess, cardActionLimiter, withdrawCard);
router.patch("/:cardId/freeze", ...cardAccess, cardActionLimiter, freezeCard);
router.patch("/:cardId/unfreeze", ...cardAccess, cardActionLimiter, unfreezeCard);
router.get("/:cardId/transactions", ...cardAccess, getCardTransactions);
router.post(
  "/:cardId/maintenance/pay",
  ...cardAccess,
  cardActionLimiter,
  payCardMaintenance
);

export default router;
