# ভিডিও বাত্তি (Video Batty) — সম্পূর্ণ রিয়েল ভার্সন

## স্ট্যাক
তিনগুটি খেলার মতোই: Node/Express ব্যাকএন্ড + MongoDB (অথবা JSON ফলব্যাক) + স্ট্যাটিক HTML ফ্রন্টএন্ড।

## ফাইল স্ট্রাকচার
```
server/   → ব্যাকএন্ড API (Render-এ ডিপ্লয় করুন)
admin/    → Admin Dashboard (যেকোনো স্ট্যাটিক হোস্টে, বা লোকালি খুলুন)
public/   → গেম/অ্যাপ ফ্রন্টএন্ড (Netlify-তে ডিপ্লয় করুন)
```

## ডিপ্লয় করার ধাপ (তিনগুটির মতোই)

1. **GitHub-এ `server/` ফোল্ডার আপলোড করুন** (নতুন রিপো, যেমন `videobatty-server`)
2. **Render.com-এ Web Service বানান** — Build: `npm install`, Start: `npm start`
3. **Environment Variables:**
   - `JWT_SECRET` = লম্বা র‍্যান্ডম স্ট্রিং
   - `ADMIN_KEY` = অ্যাডমিন পাসওয়ার্ড
   - `SUPPORT_KEY` = ঐচ্ছিক, স্টাফের জন্য
   - `MONGODB_URI` = MongoDB Atlas থেকে পাওয়া কানেকশন স্ট্রিং (তিনগুটির জন্য যেভাবে বানিয়েছিলেন, এখানে **আলাদা একটা নতুন ক্লাস্টার বা নতুন ডাটাবেজ নাম** ব্যবহার করুন যাতে দুই অ্যাপের ডেটা না মিশে যায়)
   - `AUTO_PAYOUT_ENABLED` = `false` (ডিফল্ট রাখুন)
4. **`public/index.html`-এ** `API_BASE`-এ আপনার Render লিংক বসান
5. **Netlify-তে `public/index.html` আপলোড করুন**
6. **`admin/admin.html`** ডাউনলোড করে রাখুন, ব্রাউজারে খুলে backend URL + Admin Key দিয়ে লগইন করুন

## ভিডিও লিংক বসানো
`public/index.html`-এর উপরের দিকে তিনটা অ্যারে আছে:
```js
const YOUTUBE_VIDEOS = [ { id: 'ভিডিও_আইডি', title: '...' } ];
const TIKTOK_VIDEOS = [ { url: 'https://www.tiktok.com/@user/video/...' } ];
const FACEBOOK_VIDEOS = [ { url: 'https://www.facebook.com/watch/?v=...' } ];
```
নিজের ভিডিও লিংক/আইডি বসিয়ে দিলেই ফিডে দেখাবে।

## AdMob/AdSense বসানোর জায়গা
- **ব্যানার অ্যাড:** `index.html`-এ `id="homeBannerAd"` এবং প্রোফাইল পেজের banner-ad div — এখানে AdMob (মোবাইল অ্যাপ) বা AdSense (ওয়েব) script বসান।
- **Rewarded Ad:** `watchAd()` ফাংশনের ভেতরে কমেন্ট করা আছে ঠিক কোথায় রিয়েল SDK কল বসাতে হবে।
- **AdMob SSV (সবচেয়ে শক্তিশালী anti-cheat):** `server.js`-এ `/api/ads/admob-ssv` endpoint রেডি আছে। AdMob কনসোলে আপনার Rewarded Ad Unit সেটিংসে এই URL callback হিসেবে বসান:
  `https://your-render-url.onrender.com/api/ads/admob-ssv`

## গুরুত্বপূর্ণ সীমাবদ্ধতা (সততার সাথে)
- SSV কনফিগার না করা পর্যন্ত, কয়েন অর্জন rate-limit + daily-cap দিয়ে সুরক্ষিত, কিন্তু ১০০% নিশ্চিত না (ক্লায়েন্ট বলছে "আমি অ্যাড দেখেছি")। SSV কনফিগার করলে Google নিজে কনফার্ম করবে।
- TikTok/Facebook embed-এর জন্য তাদের ভিডিও অবশ্যই **পাবলিক** হতে হবে।
- bKash অটো-পেমেন্ট এখনো প্লাগ-ইন পয়েন্ট মাত্র (`payoutProvider.js`) — ম্যানুয়াল bKash/Nagad credential যোগ না করা পর্যন্ত অ্যাডমিন প্যানেল থেকে ম্যানুয়ালি Approve করে নিজে টাকা পাঠাতে হবে।
