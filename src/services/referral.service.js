import ReferralReward from "../models/referralReward.model.js";
import User from "../models/user.model.js";
import {
  creditWallet,
  fromMinorUnit,
  generateTransactionReference,
} from "./wallet.service.js";
import { createNotificationBestEffort } from "./notification.service.js";

const DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT = 3;

const getReferralRewardPercent = () => {
  const percent = Number(
    process.env.REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT ||
      DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT
  );

  return Number.isFinite(percent) && percent > 0
    ? percent
    : DEFAULT_REFERRAL_FIRST_DEPOSIT_REWARD_PERCENT;
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
  const rewardAmount = Math.floor(
    (Number(qualifyingAmountInMinorUnit) * rewardPercent) / 100
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
  minimumRedeemAmount: Number(process.env.REFERRAL_MIN_REDEEM_AMOUNT || 100),
});
