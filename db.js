/**
 * db.js — ডাটাবেজ লেয়ার (তিনগুটির মতো একই প্যাটার্ন)
 * MONGODB_URI সেট থাকলে MongoDB Atlas ব্যবহার হবে (স্থায়ী)।
 * না থাকলে db.json ফাইলে ফলব্যাক করবে (শুধু লোকাল টেস্টিং)।
 */
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_PATH = path.join(__dirname, 'db.json');

let collection = null;
let useMongo = false;

async function initDB() {
  if (MONGODB_URI) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const dbase = client.db('video_batty');
    collection = dbase.collection('app_state');
    useMongo = true;
    console.log('✅ MongoDB Atlas সংযুক্ত - ডেটা স্থায়ীভাবে সংরক্ষিত হবে');
  } else {
    console.log('⚠️  MONGODB_URI সেট করা নেই - db.json ফাইলে ডেটা রাখা হচ্ছে (স্থায়ী না, প্রোডাকশনে MongoDB সেট করুন)');
  }
}

async function loadDB() {
  if (useMongo) {
    let doc = await collection.findOne({ _id: 'app_state' });
    if (!doc) { doc = { _id: 'app_state', users: [], withdrawals: [] }; await collection.insertOne(doc); }
    return { users: doc.users || [], withdrawals: doc.withdrawals || [] };
  }
  if (!fs.existsSync(DB_PATH)) {
    const empty = { users: [], withdrawals: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

async function saveDB(db) {
  if (useMongo) {
    await collection.updateOne({ _id: 'app_state' }, { $set: { users: db.users, withdrawals: db.withdrawals } }, { upsert: true });
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { initDB, loadDB, saveDB };
