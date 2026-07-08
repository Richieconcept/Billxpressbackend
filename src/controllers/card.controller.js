import {
  createCardCreationQuote,
  createCardFundingQuote,
  createCardWithdrawalQuote,
  createVirtualDollarCard,
  fundVirtualDollarCard,
  getAdminCardRatePreview,
  getOrCreateCardSetting,
  getVirtualDollarCardDetails,
  listAdminVirtualDollarCards,
  listVirtualDollarCards,
  listVirtualDollarCardTransactions,
  serializeCard,
  serializeCardOperation,
  serializeCardQuote,
  serializeCardSetting,
  payVirtualDollarCardMaintenance,
  setVirtualDollarCardFrozen,
  updateCardSetting,
  withdrawVirtualDollarCard,
} from "../services/card.service.js";
import {
  serializeTransaction,
  serializeWallet,
} from "../services/wallet.service.js";

const sendCardError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const getCardConfiguration = async (req, res) => {
  try {
    const setting = await getOrCreateCardSetting();
    res.json({ settings: serializeCardSetting(setting) });
  } catch (error) {
    sendCardError(res, "Could not fetch card configuration", error);
  }
};

export const quoteCardCreation = async (req, res) => {
  try {
    const quote = await createCardCreationQuote({
      userId: req.user._id,
      amountNgn: req.body?.amountNgn,
      brand: req.body?.brand,
    });
    res.status(201).json({ quote: serializeCardQuote(quote) });
  } catch (error) {
    sendCardError(res, "Could not create card quote", error);
  }
};

export const createCard = async (req, res) => {
  try {
    const result = await createVirtualDollarCard({
      userId: req.user._id,
      quoteId: req.body?.quoteId,
      transactionPin: req.body?.transactionPin,
    });
    res.status(201).json(serializeCardOperation(result));
  } catch (error) {
    sendCardError(res, "Could not create virtual dollar card", error);
  }
};

export const getCards = async (req, res) => {
  try {
    const cards = await listVirtualDollarCards(req.user._id);
    res.json({ cards: cards.map(serializeCard) });
  } catch (error) {
    sendCardError(res, "Could not fetch cards", error);
  }
};

export const getCard = async (req, res) => {
  try {
    const result = await getVirtualDollarCardDetails(
      req.user._id,
      req.params.cardId
    );
    res.json({
      card: serializeCard(result.card),
      details: result.providerCard,
      providerError: result.providerError,
    });
  } catch (error) {
    sendCardError(res, "Could not fetch card", error);
  }
};

export const quoteCardFunding = async (req, res) => {
  try {
    const quote = await createCardFundingQuote({
      userId: req.user._id,
      cardId: req.params.cardId,
      amountNgn: req.body?.amountNgn,
    });
    res.status(201).json({ quote: serializeCardQuote(quote) });
  } catch (error) {
    sendCardError(res, "Could not create funding quote", error);
  }
};

export const fundCard = async (req, res) => {
  try {
    const result = await fundVirtualDollarCard({
      userId: req.user._id,
      cardId: req.params.cardId,
      quoteId: req.body?.quoteId,
      transactionPin: req.body?.transactionPin,
    });
    res.status(201).json(serializeCardOperation(result));
  } catch (error) {
    sendCardError(res, "Could not fund card", error);
  }
};

export const quoteCardWithdrawal = async (req, res) => {
  try {
    const quote = await createCardWithdrawalQuote({
      userId: req.user._id,
      cardId: req.params.cardId,
      amountUsd: req.body?.amountUsd,
    });
    res.status(201).json({ quote: serializeCardQuote(quote) });
  } catch (error) {
    sendCardError(res, "Could not create withdrawal quote", error);
  }
};

export const withdrawCard = async (req, res) => {
  try {
    const result = await withdrawVirtualDollarCard({
      userId: req.user._id,
      cardId: req.params.cardId,
      quoteId: req.body?.quoteId,
      transactionPin: req.body?.transactionPin,
    });
    res.status(201).json(serializeCardOperation(result));
  } catch (error) {
    sendCardError(res, "Could not withdraw from card", error);
  }
};

export const freezeCard = async (req, res) => {
  try {
    const card = await setVirtualDollarCardFrozen({
      userId: req.user._id,
      cardId: req.params.cardId,
      transactionPin: req.body?.transactionPin,
      frozen: true,
    });
    res.json({ message: "Card frozen successfully", card: serializeCard(card) });
  } catch (error) {
    sendCardError(res, "Could not freeze card", error);
  }
};

export const unfreezeCard = async (req, res) => {
  try {
    const card = await setVirtualDollarCardFrozen({
      userId: req.user._id,
      cardId: req.params.cardId,
      transactionPin: req.body?.transactionPin,
      frozen: false,
    });
    res.json({
      message: "Card unfrozen successfully",
      card: serializeCard(card),
    });
  } catch (error) {
    sendCardError(res, "Could not unfreeze card", error);
  }
};

export const getCardTransactions = async (req, res) => {
  try {
    const transactions = await listVirtualDollarCardTransactions({
      userId: req.user._id,
      cardId: req.params.cardId,
      query: req.query,
    });
    res.json(transactions);
  } catch (error) {
    sendCardError(res, "Could not fetch card transactions", error);
  }
};

export const payCardMaintenance = async (req, res) => {
  try {
    const result = await payVirtualDollarCardMaintenance({
      userId: req.user._id,
      cardId: req.params.cardId,
      transactionPin: req.body?.transactionPin,
    });
    res.json({
      message: result.message,
      card: serializeCard(result.card),
      wallet: serializeWallet(result.wallet),
      transaction: serializeTransaction(result.transaction),
    });
  } catch (error) {
    sendCardError(res, "Could not pay card maintenance fee", error);
  }
};

export const getAdminCardSettings = async (req, res) => {
  try {
    const setting = await getOrCreateCardSetting();
    res.json({ settings: serializeCardSetting(setting) });
  } catch (error) {
    sendCardError(res, "Could not fetch card settings", error);
  }
};

export const getAdminCards = async (req, res) => {
  try {
    const result = await listAdminVirtualDollarCards(req.query || {});
    res.json(result);
  } catch (error) {
    sendCardError(res, "Could not fetch virtual dollar cards", error);
  }
};

export const getAdminCardRates = async (req, res) => {
  try {
    const rates = await getAdminCardRatePreview({
      amountNgn: req.query?.amountNgn || 10000,
      amountUsd: req.query?.amountUsd || 10,
    });
    res.json({ rates });
  } catch (error) {
    sendCardError(res, "Could not fetch live card exchange rates", error);
  }
};

export const updateAdminCardSettings = async (req, res) => {
  try {
    const setting = await updateCardSetting(req.body || {}, req.user._id);
    res.json({
      message: "Card settings updated successfully",
      settings: serializeCardSetting(setting),
    });
  } catch (error) {
    sendCardError(res, "Could not update card settings", error);
  }
};
