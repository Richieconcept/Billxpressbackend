import ReferralReward from "../models/referralReward.model.js";
import User from "../models/user.model.js";
import Wallet from "../models/wallet.model.js";
import {
  getReferralRewardSettings,
  serializeReferralReward,
} from "../services/referral.service.js";
import { fromMinorUnit } from "../services/wallet.service.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

const sendReferralError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

const getReferralCodeQuery = (referralCode) =>
  new RegExp(`^${String(referralCode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

export const getReferralSummary = async (req, res) => {
  try {
    const referralCode = req.user.referralCode;
    const [wallet, referredUsersCount, successfulRewards] = await Promise.all([
      Wallet.findOne({ user: req.user._id }),
      User.countDocuments({ referredBy: getReferralCodeQuery(referralCode) }),
      ReferralReward.find({
        referrer: req.user._id,
        status: "successful",
      }),
    ]);
    const totalReferralEarned = successfulRewards.reduce(
      (total, reward) => total + reward.rewardAmount,
      0
    );
    const qualifiedRewardsCount = successfulRewards.length;

    res.json({
      referral: {
        referralCode,
        settings: getReferralRewardSettings(),
        referredUsersCount,
        qualifiedRewardsCount,
        pendingReferralsCount: Math.max(
          referredUsersCount - qualifiedRewardsCount,
          0
        ),
        totalReferralEarned: fromMinorUnit(totalReferralEarned),
        referralBalance: fromMinorUnit(wallet?.referralBalance || 0),
      },
    });
  } catch (error) {
    sendReferralError(res, "Could not fetch referral summary", error);
  }
};

export const listReferralRewards = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const [rewards, total] = await Promise.all([
      ReferralReward.find({ referrer: req.user._id })
        .populate("referredUser", "firstName lastName username email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ReferralReward.countDocuments({ referrer: req.user._id }),
    ]);

    res.json({
      rewards: rewards.map((reward) => ({
        ...serializeReferralReward(reward),
        referredUser: reward.referredUser,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendReferralError(res, "Could not fetch referral rewards", error);
  }
};

export const listReferredUsers = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find({ referredBy: getReferralCodeQuery(req.user.referralCode) })
        .select("-password -transactionPin -emailVerificationOtp")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments({ referredBy: getReferralCodeQuery(req.user.referralCode) }),
    ]);
    const userIds = users.map((user) => user._id);
    const rewards = await ReferralReward.find({
      referrer: req.user._id,
      referredUser: { $in: userIds },
    });
    const rewardsByUser = new Map(
      rewards.map((reward) => [String(reward.referredUser), reward])
    );

    res.json({
      referredUsers: users.map((user) => {
        const reward = rewardsByUser.get(String(user._id));

        return {
          user: sanitizeUser(user),
          qualified: reward?.status === "successful",
          reward: reward ? serializeReferralReward(reward) : null,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendReferralError(res, "Could not fetch referred users", error);
  }
};

export const listAdminReferralRewards = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = {};

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.referrerId) {
      query.referrer = req.query.referrerId;
    }

    if (req.query.referredUserId) {
      query.referredUser = req.query.referredUserId;
    }

    const [rewards, total] = await Promise.all([
      ReferralReward.find(query)
        .populate("referrer", "firstName lastName username email phone")
        .populate("referredUser", "firstName lastName username email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ReferralReward.countDocuments(query),
    ]);

    res.json({
      rewards: rewards.map((reward) => ({
        ...serializeReferralReward(reward),
        referrer: reward.referrer,
        referredUser: reward.referredUser,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      settings: getReferralRewardSettings(),
    });
  } catch (error) {
    sendReferralError(res, "Could not fetch referral rewards", error);
  }
};
