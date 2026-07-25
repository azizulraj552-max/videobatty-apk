কীস্টোর পাসওয়ার্ড: VideoBatty2026Secure
কী alias: videobatty

GitHub-এ যা করবেন:
1. রিপো → Settings → Secrets and variables → Actions
2. SIGNING_KEYSTORE_BASE64 সিক্রেটে ক্লিক করে "Update"
3. videobatty-release.keystore.base64 ফাইলটা খুলে পুরো কনটেন্ট (Ctrl+A দিয়ে সব সিলেক্ট) কপি করে পেস্ট করুন
   - শুরুতে/শেষে কোনো স্পেস বা নতুন লাইন যোগ করবেন না
4. KEYSTORE_PASSWORD সিক্রেটে ক্লিক করে "Update" → মান বসান: VideoBatty2026Secure
5. দুটোই Save করুন
6. Actions ট্যাবে গিয়ে workflow আবার রান করুন (Re-run all jobs)
