/**
 * ভিডিও বাত্তি - Backend Server
 * ------------------------------------------------------------
 * - রিয়েল ইউজার অথ (নাম/ফোন/পাসওয়ার্ড, bcrypt হ্যাশড, JWT সেশন)
 * - সার্ভার-সাইড কয়েন (ক্লায়েন্ট নিজে কয়েন বাড়াতে পারবে না)
 * - প্রতিটা "অ্যাড দেখলাম" রিকোয়েস্ট rate-limited + daily-capped
 * - AdMob Rewarded Ad-এর জন্য Server-Side Verification (SSV) endpoint
 *   রেডি আছে - এটা কনফিগার করলে (AdMob কনসোলে callback URL বসিয়ে)
 *   সবচেয়ে শক্তিশালী anti-cheat হয়, কারণ তখন Google নিজেই কনফার্ম করে
 *   ইউজার সত্যিই সম্পূর্ণ অ্যাড দেখেছে কিনা।
 * - উত্তোলন সবসময় "pending", অ্যাডমিন ম্যানুয়ালি অ্যাপ্রুভ করে
 *   (অথবা bKash credential যোগ করলে payoutProvider.js দিয়ে অটো)
 */

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { initDB, loadDB, saveDB } = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' })); // ছবি আপলোডের জন্য বড় লিমিট

const PORT = process.env.PORT || 4100;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_BEFORE_DEPLOYING';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_THIS_ADMIN_KEY';
const SUPPORT_KEY = process.env.SUPPORT_KEY || '';
const AUTO_PAYOUT_ENABLED = process.env.AUTO_PAYOUT_ENABLED === 'true';

// ---------- বিজনেস রুলস ----------
const COINS_TO_TAKA_RATE = 2000; // 2000 coins = 10 taka
const TAKA_PER_2000_COINS = 10;
const MIN_WITHDRAW_TAKA = 50;
const DAILY_MAX_COINS = 500; // প্রতিদিন সর্বোচ্চ কত কয়েন অ্যাড দেখে অর্জন করা যাবে
// ================= কয়েন রেট: শুধু দুটো স্তর, যেমনটা চাওয়া হয়েছে =================
// সাধারণ এড (দ্রুত, ৫ সেকেন্ড ব্যানার) = ৫ পয়েন্ট
// ভিডিও এড (টাইমার-বাধ্যতামূলক, ১৮ সেকেন্ড) = ১০ পয়েন্ট
// ⚠️ ডেইলি বোনাস (daily) এই "অ্যাড" সিস্টেমের অংশ না - এটা আলাদা, প্রতিদিন
// লগইন করলে স্ট্রিক অনুযায়ী বোনাস (৩-২১ পয়েন্ট) - এটা অ্যাড বাটনের পয়েন্টের
// সাথে গুলিয়ে ফেলবেন না।
const SIMPLE_AD_POINTS = 5;
const VIDEO_AD_POINTS = 10;
const REWARD_MAP = {
  ad1: SIMPLE_AD_POINTS, ad2: SIMPLE_AD_POINTS, ad3: SIMPLE_AD_POINTS, ad4: SIMPLE_AD_POINTS, // হোম পেজের ৪টা সাধারণ এড বাটন
  bonus: SIMPLE_AD_POINTS, reward2: SIMPLE_AD_POINTS, offerwall: SIMPLE_AD_POINTS, // Earn Hub-এর সাধারণ অপশন
  floating: VIDEO_AD_POINTS, reward1: VIDEO_AD_POINTS, reward3: VIDEO_AD_POINTS   // ভিডিও এড (টাইমার সহ)
};
const MIN_GAP_SECONDS = { floating: 30, default: 8 }; // প্রতিটা সোর্সের জন্য ন্যূনতম বিরতি

// ---------- Rate Limiters ----------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'অনেক বেশি চেষ্টা হয়েছে, ১৫ মিনিট পর আবার চেষ্টা করুন' } });
const adLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'অনেক দ্রুত! একটু অপেক্ষা করুন' } });
const withdrawLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'ঘন্টায় সর্বোচ্চ উত্তোলন চেষ্টার সীমা শেষ' } });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 150 });
app.use(generalLimiter);

// ---------- Auth মিডলওয়্যার ----------
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'লগইন প্রয়োজন' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    return res.status(401).json({ error: 'সেশন মেয়াদোত্তীর্ণ, আবার লগইন করুন' });
  }
}
function adminRequired(req, res, next) {
  if (req.headers['x-admin-key'] === ADMIN_KEY) { req.adminRole = 'admin'; return next(); }
  return res.status(403).json({ error: 'Admin key ভুল' });
}
function adminOrSupportRequired(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key === ADMIN_KEY) { req.adminRole = 'admin'; return next(); }
  if (SUPPORT_KEY && key === SUPPORT_KEY) { req.adminRole = 'support'; return next(); }
  return res.status(403).json({ error: 'Key ভুল' });
}

function taToday() { return new Date().toISOString().slice(0, 10); }
function genReferralCode() { return 'VB' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
function publicUser(u) {
  return {
    id: u.id, name: u.name, phone: u.phone,
    coins: u.coins, adsWatched: u.adsWatched || 0,
    takaValue: Math.floor((u.coins / COINS_TO_TAKA_RATE) * TAKA_PER_2000_COINS),
    referralCode: u.referralCode,
    loginStreak: u.loginStreak || 0,
    avatarBase64: u.avatarBase64 || null,
    language: u.language || 'bn',
    customVideos: u.customVideos || []
  };
}

// ================= AUTH =================

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, phone, password, referralCode } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'নাম, ফোন এবং পাসওয়ার্ড দিন' });
  if (password.length < 6) return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });

  const db = await loadDB();
  if (db.users.find(u => u.phone === phone)) return res.status(409).json({ error: 'এই নাম্বার দিয়ে আগে থেকে একাউন্ট আছে, লগইন করুন' });

  let referredBy = null;
  if (referralCode) {
    const referrer = db.users.find(u => u.referralCode === referralCode.trim().toUpperCase());
    if (referrer) referredBy = referrer.id;
  }

  const ip = req.ip;
  const sameIpCount = db.users.filter(u => u.registeredIp === ip).length;
  const passwordHash = await bcrypt.hash(password, 10);
  let newReferralCode;
  do { newReferralCode = genReferralCode(); } while (db.users.find(u => u.referralCode === newReferralCode));

  const user = {
    id: uuidv4(), name, phone, passwordHash,
    coins: 0, adsWatched: 0,
    coinsToday: 0, coinsTodayDate: taToday(),
    lastAdAt: {}, // { source: timestampMs } - প্রতিটা সোর্সের শেষ claim সময়
    registeredIp: ip, suspiciousMultiAccount: sameIpCount >= 3,
    referralCode: newReferralCode, referredBy, referralBonusGiven: false,
    loginStreak: 1, lastLoginDate: taToday(),
    dailyBonusClaimedDate: null,
    customVideos: [], // ইউজার নিজে যোগ করা ভিডিও লিংক
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  await saveDB(db);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { phone, password } = req.body;
  const db = await loadDB();
  const user = db.users.find(u => u.phone === phone);
  if (!user) return res.status(401).json({ error: 'একাউন্ট পাওয়া যায়নি' });
  if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'পাসওয়ার্ড ভুল' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', authRequired, async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  res.json({ user: publicUser(user) });
});

// ================= কয়েন অর্জন (স্বেচ্ছায় অ্যাড দেখে) =================

function checkReferralBonus(db, user) {
  const REFERRAL_BONUS = 100;
  if (user && user.referredBy && !user.referralBonusGiven && user.adsWatched >= 1) {
    const referrer = db.users.find(u => u.id === user.referredBy);
    if (referrer) { referrer.coins += REFERRAL_BONUS; user.referralBonusGiven = true; }
  }
}

app.post('/api/coins/watch-ad', authRequired, adLimiter, async (req, res) => {
  const { source } = req.body;
  if (!REWARD_MAP[source]) return res.status(400).json({ error: 'ভুল সোর্স' });

  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });

  const now = Date.now();
  const minGap = (MIN_GAP_SECONDS[source] || MIN_GAP_SECONDS.default) * 1000;
  const lastAt = (user.lastAdAt && user.lastAdAt[source]) || 0;
  if (now - lastAt < minGap) {
    const waitSec = Math.ceil((minGap - (now - lastAt)) / 1000);
    return res.status(429).json({ error: `আরেকটু অপেক্ষা করুন (${waitSec}s)` });
  }

  if (user.coinsTodayDate !== taToday()) { user.coinsTodayDate = taToday(); user.coinsToday = 0; }
  if (user.coinsToday >= DAILY_MAX_COINS) {
    return res.status(429).json({ error: 'আজকের সর্বোচ্চ কয়েন সীমা শেষ, কাল আবার আসুন' });
  }

  const reward = REWARD_MAP[source];
  user.coins += reward;
  user.coinsToday += reward;
  user.adsWatched = (user.adsWatched || 0) + 1;
  if (!user.lastAdAt) user.lastAdAt = {};
  user.lastAdAt[source] = now;

  checkReferralBonus(db, user);
  await saveDB(db);
  res.json({ reward, user: publicUser(user) });
});

// ================= ডেইলি লগইন বোনাস =================
app.post('/api/daily-bonus', authRequired, async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  const today = taToday();
  if (user.dailyBonusClaimedDate === today) return res.json({ alreadyClaimed: true, user: publicUser(user) });

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  user.loginStreak = (user.lastLoginDate === yesterday) ? (user.loginStreak || 0) + 1 : 1;
  if (user.loginStreak > 7) user.loginStreak = 1;
  const bonus = 10; // ⚠️ ফিক্স: আগে স্ট্রিক অনুযায়ী ৩-২১ পয়েন্ট পর্যন্ত বাড়ত, এখন ফিক্সড ১০ (সর্বোচ্চ সীমার মধ্যে)
  user.coins += bonus;
  user.lastLoginDate = today;
  user.dailyBonusClaimedDate = today;
  await saveDB(db);
  res.json({ alreadyClaimed: false, bonus, streak: user.loginStreak, user: publicUser(user) });
});

// ================= প্রোফাইল ছবি আপলোড =================
// ⚠️ ছবি MongoDB ডকুমেন্টেই base64 আকারে থাকে (আলাদা ইমেজ CDN নেই)।
// তাই ক্লায়েন্ট-সাইডে ছোট (≤150px) ও কম্প্রেসড করে পাঠানো হয় (index.html দেখুন)।
// ইউজার সংখ্যা অনেক বেশি (কয়েক হাজার+) হলে ভবিষ্যতে Cloudinary/S3-এর
// মতো আলাদা ইমেজ স্টোরেজে সরানো ভালো হবে।
app.post('/api/me/avatar', authRequired, async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64 || !imageBase64.startsWith('data:image/')) return res.status(400).json({ error: 'ভুল ছবি ফরম্যাট' });
  if (imageBase64.length > 300000) return res.status(400).json({ error: 'ছবি অনেক বড়, ছোট করে আবার চেষ্টা করুন' });
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  user.avatarBase64 = imageBase64;
  await saveDB(db);
  res.json({ user: publicUser(user) });
});

app.post('/api/me/language', authRequired, async (req, res) => {
  const { language } = req.body;
  if (!['bn', 'en'].includes(language)) return res.status(400).json({ error: 'ভুল ভাষা কোড' });
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  user.language = language;
  await saveDB(db);
  res.json({ user: publicUser(user) });
});

// ================= ইউজার নিজের ভিডিও লিংক যোগ করা =================
// ⚠️ শুধু পাবলিক ভিডিওর লিংক কাজ করবে (private/restricted ভিডিও embed হবে না,
// এটা YouTube/TikTok/Facebook-এর নিজস্ব সীমাবদ্ধতা, আমাদের কোডের সমস্যা না)।
const MAX_CUSTOM_VIDEOS = 15;
app.post('/api/me/videos', authRequired, async (req, res) => {
  const { platform, url, title } = req.body;
  if (!['youtube', 'tiktok', 'funny'].includes(platform)) return res.status(400).json({ error: 'ভুল প্ল্যাটফর্ম' });
  if (!url || !url.trim()) return res.status(400).json({ error: 'ভিডিও লিংক দিন' });

  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  if (!user.customVideos) user.customVideos = [];
  if (user.customVideos.length >= MAX_CUSTOM_VIDEOS) return res.status(400).json({ error: `সর্বোচ্চ ${MAX_CUSTOM_VIDEOS}টা ভিডিও যোগ করা যাবে` });

  user.customVideos.push({ id: uuidv4(), platform, url: url.trim(), title: (title || 'আমার ভিডিও').trim(), addedAt: new Date().toISOString() });
  await saveDB(db);
  res.json({ user: publicUser(user) });
});

app.delete('/api/me/videos/:id', authRequired, async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  user.customVideos = (user.customVideos || []).filter(v => v.id !== req.params.id);
  await saveDB(db);
  res.json({ user: publicUser(user) });
});

// ================= AdMob Server-Side Verification (SSV) =================
// AdMob কনসোলে (Rewarded Ad Unit সেটিংসে) এই URL callback হিসেবে বসান:
//   https://your-api-domain.com/api/ads/admob-ssv?[query params AdMob নিজে যোগ করবে]
// এটা কনফিগার করলে ক্লায়েন্ট-সাইড watch-ad কলের বদলে (বা তার পাশাপাশি)
// Google নিজে সরাসরি কনফার্ম করবে অ্যাড সম্পূর্ণ দেখা হয়েছে কিনা - সবচেয়ে
// নির্ভরযোগ্য anti-cheat পদ্ধতি। বিস্তারিত: 
// https://developers.google.com/admob/android/rewarded-video-ssv
let admobPublicKeys = null;
let admobKeysFetchedAt = 0;
async function getAdMobPublicKeys() {
  if (admobPublicKeys && Date.now() - admobKeysFetchedAt < 3600000) return admobPublicKeys;
  const res = await fetch('https://www.gstatic.com/admob/reward/verifier-keys.json');
  const data = await res.json();
  admobPublicKeys = data.keys;
  admobKeysFetchedAt = Date.now();
  return admobPublicKeys;
}

app.get('/api/ads/admob-ssv', async (req, res) => {
  try {
    const { user_id, reward_amount, key_id, signature, ad_network, timestamp, transaction_id } = req.query;
    if (!user_id || !signature || !key_id) return res.status(400).send('missing params');

    // স্বাক্ষর যাচাই (AdMob-এর ডকুমেন্টেশন অনুযায়ী - query string-এর signature/key_id
    // বাদ দিয়ে বাকি অংশ দিয়ে ECDSA verify করা হয়)
    const keys = await getAdMobPublicKeys();
    const matchedKey = keys.find(k => String(k.keyId) === String(key_id));
    if (!matchedKey) return res.status(400).send('unknown key_id');

    const url = new URL(req.originalUrl, `https://${req.headers.host}`);
    const contentParams = [];
    for (const [k, v] of url.searchParams) {
      if (k === 'signature' || k === 'key_id') continue;
      contentParams.push(`${k}=${v}`);
    }
    const content = contentParams.join('&');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(content);
    const isValid = verifier.verify(
      { key: matchedKey.pem, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    );
    if (!isValid) return res.status(400).send('invalid signature');

    // যাচাই সফল হলে ইউজারকে পয়েন্ট দিন (user_id-তে আপনার ইউজার ID পাঠাতে হবে
    // AdMob SDK কল করার সময় setServerSideVerificationOptions দিয়ে)
    const db = await loadDB();
    const user = db.users.find(u => u.id === user_id);
    if (user) {
      const reward = parseInt(reward_amount) || 10;
      user.coins += reward;
      user.adsWatched = (user.adsWatched || 0) + 1;
      await saveDB(db);
    }
    res.status(200).send('OK');
  } catch (e) {
    console.error('AdMob SSV error:', e.message);
    res.status(500).send('error');
  }
});

// ================= WITHDRAWALS =================

app.post('/api/wallet/withdraw', authRequired, withdrawLimiter, async (req, res) => {
  const { method, number, amountTaka } = req.body;
  if (!method || !number || !amountTaka) return res.status(400).json({ error: 'মাধ্যম, নাম্বার এবং পরিমান দিন' });
  if (amountTaka < MIN_WITHDRAW_TAKA) return res.status(400).json({ error: `সর্বনিম্ন উত্তোলন ${MIN_WITHDRAW_TAKA} টাকা` });

  const requiredCoins = Math.ceil((amountTaka / TAKA_PER_2000_COINS) * COINS_TO_TAKA_RATE);
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  if (user.coins < requiredCoins) return res.status(400).json({ error: 'পর্যাপ্ত কয়েন নেই' });

  user.coins -= requiredCoins;
  const withdrawal = {
    id: uuidv4(), userId: user.id, userName: user.name, userPhone: user.phone,
    method, number, amountTaka, coinsUsed: requiredCoins,
    status: 'pending', createdAt: new Date().toISOString()
  };
  db.withdrawals.push(withdrawal);
  await saveDB(db);

  if (AUTO_PAYOUT_ENABLED) {
    try {
      const { sendPayout } = require('./payoutProvider');
      const result = await sendPayout({ method, number, amountTaka });
      withdrawal.status = 'approved';
      withdrawal.approvedAt = new Date().toISOString();
      withdrawal.autoPayoutRef = result.transactionId;
      await saveDB(db);
    } catch (e) {
      console.error('Auto payout failed, falling back to manual queue:', e.message);
    }
  }

  res.json({ withdrawal, user: publicUser(user) });
});

app.get('/api/wallet/my-withdrawals', authRequired, async (req, res) => {
  const db = await loadDB();
  res.json({ withdrawals: db.withdrawals.filter(w => w.userId === req.userId).reverse() });
});

// ================= ADMIN =================

app.get('/api/admin/withdrawals', adminOrSupportRequired, async (req, res) => {
  const db = await loadDB();
  res.json({ withdrawals: db.withdrawals.slice().reverse() });
});

app.post('/api/admin/withdrawals/:id/approve', adminRequired, async (req, res) => {
  const db = await loadDB();
  const w = db.withdrawals.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'পাওয়া যায়নি' });
  w.status = 'approved'; w.approvedAt = new Date().toISOString();
  await saveDB(db);
  res.json({ withdrawal: w });
});

app.post('/api/admin/withdrawals/:id/reject', adminRequired, async (req, res) => {
  const db = await loadDB();
  const w = db.withdrawals.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'পাওয়া যায়নি' });
  if (w.status === 'pending') {
    const user = db.users.find(u => u.id === w.userId);
    if (user) user.coins += w.coinsUsed;
  }
  w.status = 'rejected'; w.rejectedAt = new Date().toISOString();
  await saveDB(db);
  res.json({ withdrawal: w });
});

app.get('/api/admin/users', adminOrSupportRequired, async (req, res) => {
  const db = await loadDB();
  res.json({ users: db.users.map(u => ({ ...publicUser(u), suspiciousMultiAccount: u.suspiciousMultiAccount, createdAt: u.createdAt })) });
});

app.post('/api/admin/users/:phone/reset-password', adminRequired, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে' });
  const db = await loadDB();
  const user = db.users.find(u => u.phone === req.params.phone);
  if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await saveDB(db);
  res.json({ success: true });
});

app.get('/api/admin/stats', adminOrSupportRequired, async (req, res) => {
  const db = await loadDB();
  const totalUsers = db.users.length;
  const totalCoinsOutstanding = db.users.reduce((s, u) => s + u.coins, 0);
  const pending = db.withdrawals.filter(w => w.status === 'pending');
  const approved = db.withdrawals.filter(w => w.status === 'approved');
  res.json({
    totalUsers,
    totalCoinsOutstanding,
    totalTakaLiability: Math.floor((totalCoinsOutstanding / COINS_TO_TAKA_RATE) * TAKA_PER_2000_COINS),
    pendingCount: pending.length,
    pendingTaka: pending.reduce((s, w) => s + w.amountTaka, 0),
    approvedCount: approved.length,
    approvedTaka: approved.reduce((s, w) => s + w.amountTaka, 0),
    suspiciousUsers: db.users.filter(u => u.suspiciousMultiAccount).length,
    totalAdsWatched: db.users.reduce((s, u) => s + (u.adsWatched || 0), 0)
  });
});

(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`✅ ভিডিও বাত্তি সার্ভার চলছে: http://localhost:${PORT}`);
    console.log(`✅ Auto Payout: ${AUTO_PAYOUT_ENABLED ? 'চালু' : 'বন্ধ (ম্যানুয়াল মোডে চলছে)'}`);
    console.log(`⚠️  JWT_SECRET এবং ADMIN_KEY এনভায়রনমেন্ট ভ্যারিয়েবল দিয়ে সেট করুন প্রোডাকশনে`);
  });
})();
