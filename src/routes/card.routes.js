import express from "express";
import {
  createCard,
  freezeCard,
  fundCard,
  getCard,
  getCardConfiguration,
  getCards,
  getCardTransactions,
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

const router = express.Router();
const cardAccess = [protect, requireVerifiedEmail, requireAuthTier("tier_3")];

router.get("/configuration", ...cardAccess, getCardConfiguration);
router.get("/", ...cardAccess, getCards);
router.post("/creation-quote", ...cardAccess, quoteCardCreation);
router.post("/", ...cardAccess, createCard);
router.get("/:cardId", ...cardAccess, getCard);
router.post("/:cardId/funding-quote", ...cardAccess, quoteCardFunding);
router.post("/:cardId/fund", ...cardAccess, fundCard);
router.post("/:cardId/withdrawal-quote", ...cardAccess, quoteCardWithdrawal);
router.post("/:cardId/withdraw", ...cardAccess, withdrawCard);
router.patch("/:cardId/freeze", ...cardAccess, freezeCard);
router.patch("/:cardId/unfreeze", ...cardAccess, unfreezeCard);
router.get("/:cardId/transactions", ...cardAccess, getCardTransactions);

export default router;
