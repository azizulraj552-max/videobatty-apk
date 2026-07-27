/**
 * Payout Provider — অটো-পেমেন্টের প্লাগ-ইন পয়েন্ট (এখনো "কাজ করে না")
 * রিয়েল bKash Merchant Payout API credential ছাড়া এটা কাজ করবে না।
 * credential পেলে sendPayout() এর ভেতরে bKash-এর অফিসিয়াল কোড বসান
 * এবং server.js-এ AUTO_PAYOUT_ENABLED=true সেট করুন।
 */
async function sendPayout({ method, number, amountTaka }) {
  const appKey = process.env.BKASH_APP_KEY;
  const appSecret = process.env.BKASH_APP_SECRET;
  const username = process.env.BKASH_USERNAME;
  const password = process.env.BKASH_PASSWORD;
  if (!appKey || !appSecret || !username || !password) {
    throw new Error('bKash payout credentials কনফিগার করা হয়নি - ম্যানুয়াল সারিতে থাকবে');
  }
  // ⚠️ এখানে bKash-এর অফিসিয়াল Disbursement API কল বসবে (তাদের বর্তমান
  // ডেভেলপার পোর্টাল থেকে যাচাই করা এন্ডপয়েন্ট/প্যারামিটার দিয়ে)।
  throw new Error('bKash payout ইন্টিগ্রেশন এখনো বসানো হয়নি - এই ফাইলে TODO দেখুন');
}
module.exports = { sendPayout };
