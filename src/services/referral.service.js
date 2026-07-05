import ReferralReward from "../models/referralReward.model.js";
import Transaction from "../models/transaction.model.js";
import User from "../models/user.model.js";
import {
  creditWallet,
  fromMinorUnit,
  generateTransactionReference,
} from "./wallet.service.js";
import { createNotificationBestEffort } from "./notification.service.js";

const DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT = 3;
const DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_CAP = 300;
const DEFAULT_REFERRAL_MINIMUM_SERVICE_PURCHASE = 1000;
const DEFAULT_REFERRAL_MINIMUM_REDEEM_AMOUNT = 30;

const getPositiveSetting = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getReferralRewardPercent = () => {
  const percent = Number(
    process.env.REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT ||
      DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT
  );

  return Number.isFinite(percent) && percent > 0
    ? percent
    : DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT;
};

const getReferralRewardCapInMinorUnit = () =>
  Math.round(
    getPositiveSetting(
      "REFERRAL_FIRST_DEPOSIT_REWARD_CAP",
      DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_CAP
    ) * 100
  );

const getMinimumServicePurchaseInMinorUnit = () =>
  Math.round(
    getPositiveSetting(
      "REFERRAL_MINIMUM_SERVICE_PURCHASE",
      DEFAULT_REFERRAL_MINIMUM_SERVICE_PURCHASE
    ) * 100
  );

export const getMinimumReferralRedeemAmountInMinorUnit = () =>
  Math.round(
    getPositiveSetting(
      "REFERRAL_MIN_REDEEM_AMOUNT",
      DEFAULT_REFERRAL_MINIMUM_REDEEM_AMOUNT
    ) * 100
  );

export const getReferralRedemptionEligibility = async (referrerId) => {
  const rewardCap = getReferralRewardCapInMinorUnit();
  const rewards = await ReferralReward.find({
    referrer: referrerId,
    status: "successful",
    rewardAmount: { $gte: rewardCap },
  }).select("referredUser rewardAmount");

  if (!rewards.length) {
    return {
      lockedAmountInMinorUnit: 0,
      unqualifiedReferrals: 0,
      minimumServicePurchaseInMinorUnit:
        getMinimumServicePurchaseInMinorUnit(),
    };
  }

  const minimumPurchase = getMinimumServicePurchaseInMinorUnit();
  const referredUserIds = rewards.map((reward) => reward.referredUser);
  const qualifiedUserIds = await Transaction.distinct("user", {
    user: { $in: referredUserIds },
    type: "service_payment",
    walletType: "main",
    direction: "debit",
    status: "successful",
    amount: { $gte: minimumPurchase },
  });
  const qualifiedUsers = new Set(qualifiedUserIds.map(String));
  const lockedRewards = rewards.filter(
    (reward) => !qualifiedUsers.has(String(reward.referredUser))
  );

  return {
    lockedAmountInMinorUnit: lockedRewards.reduce(
      (total, reward) => total + reward.rewardAmount,
      0
    ),
    unqualifiedReferrals: lockedRewards.length,
    minimumServicePurchaseInMinorUnit: minimumPurchase,
  };
};

export const serializeReferralReward = (reward) => ({
  id: reward._id,
  referrer: reward.referrer,
  referredUser: reward.referredUser,
  trigger: reward.trigger,
  qualifyingAmount: fromMinorUnit(reward.qualifyingAmount),
  rewardPercent: reward.rewardPercent,
  rewardAmount: fromMinorUnit(reward.rewardAmount),
  status: reward.status,
  fundingTransaction: reward.fundingTransaction,
  rewardTransaction: reward.rewardTransaction,
  failureReason: reward.failureReason,
  metadata: reward.metadata,
  createdAt: reward.createdAt,
  updatedAt: reward.updatedAt,
});

export const processFirstDepositReferralReward = async ({
  referredUserId,
  qualifyingAmountInMinorUnit,
  fundingTransaction,
  provider,
  providerReference,
}) => {
  const referredUser = await User.findById(referredUserId);

  if (!referredUser?.referredBy) {
    return {
      rewarded: false,
      reason: "User was not referred",
    };
  }

  const referrer = await User.findOne({
    referralCode: String(referredUser.referredBy).trim().toUpperCase(),
    isActive: true,
  });

  if (!referrer) {
    return {
      rewarded: false,
      reason: "Referrer not found",
    };
  }

  if (String(referrer._id) === String(referredUser._id)) {
    return {
      rewarded: false,
      reason: "Self referral is not allowed",
    };
  }

  const rewardPercent = getReferralRewardPercent();
  const rewardAmount = Math.min(
    Math.floor((Number(qualifyingAmountInMinorUnit) * rewardPercent) / 100),
    getReferralRewardCapInMinorUnit()
  );

  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    return {
      rewarded: false,
      reason: "Reward amount is too low",
    };
  }

  let referralReward;

  try {
    referralReward = await ReferralReward.create({
      referrer: referrer._id,
      referredUser: referredUser._id,
      trigger: "first_deposit",
      qualifyingAmount: qualifyingAmountInMinorUnit,
      rewardPercent,
      rewardAmount,
      fundingTransaction: fundingTransaction?._id || null,
      metadata: {
        provider,
        providerReference,
        referredUserEmail: referredUser.email,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return {
        rewarded: false,
        reason: "First deposit referral reward already processed",
      };
    }

    throw error;
  }

  try {
    const creditResult = await creditWallet({
      userId: referrer._id,
      amountInMinorUnit: rewardAmount,
      walletType: "referral",
      type: "referral_earning",
      reference: generateTransactionReference("REFEARN"),
      narration: "Referral reward from referred user's first deposit",
      metadata: {
        referralReward: referralReward._id,
        referredUser: referredUser._id,
        qualifyingAmount: qualifyingAmountInMinorUnit,
        rewardPercent,
        provider,
        providerReference,
      },
    });

    referralReward.status = "successful";
    referralReward.rewardTransaction = creditResult.transaction._id;
    await referralReward.save();

    await createNotificationBestEffort({
      userId: referrer._id,
      title: "Referral reward received",
      message: `You earned NGN ${fromMinorUnit(
        rewardAmount
      )} from ${referredUser.firstName}'s first deposit.`,
      type: "referral_reward",
      channel: "both",
      priority: "normal",
      data: {
        amount: fromMinorUnit(rewardAmount),
        rewardPercent,
        qualifyingAmount: fromMinorUnit(qualifyingAmountInMinorUnit),
        referredUser: referredUser._id,
        reference: creditResult.transaction.reference,
      },
    });

    return {
      rewarded: true,
      reward: referralReward,
      wallet: creditResult.wallet,
      transaction: creditResult.transaction,
    };
  } catch (error) {
    referralReward.status = "failed";
    referralReward.failureReason = error.message;
    await referralReward.save();
    throw error;
  }
};

export const processFirstDepositReferralRewardBestEffort = async (payload) => {
  try {
    return await processFirstDepositReferralReward(payload);
  } catch (error) {
    console.error("Referral reward processing failed", error);
    return {
      rewarded: false,
      reason: error.message,
    };
  }
};

export const getReferralRewardSettings = () => ({
  firstDepositRewardPercent: getReferralRewardPercent(),
  firstDepositRewardCap: fromMinorUnit(getReferralRewardCapInMinorUnit()),
  minimumServicePurchase: fromMinorUnit(
    getMinimumServicePurchaseInMinorUnit()
  ),
  minimumRedeemAmount: fromMinorUnit(
    getMinimumReferralRedeemAmountInMinorUnit()
  ),
});
