/*************************************************************
 * FIREBASE CONNECTION
 * -----------------------------------------------------------
 * 1. Go to https://console.firebase.google.com  ->  your project
 * 2. Project Settings (gear icon)  ->  "Your apps"  ->  Web app (</>)
 * 3. Copy the firebaseConfig object it shows you and paste it below,
 *    replacing every "PASTE_..." value.
 * 4. IMPORTANT: databaseURL must point at your Realtime Database, e.g.
 *      https://meethigolee-default-rtdb.firebaseio.com
 *    (Build -> Realtime Database -> create database, choose a region).
 *
 * These keys are NOT secret for a client-side app — access is
 * controlled by the Realtime Database security rules (database.rules.json).
 *************************************************************/

const firebaseConfig = {
  apiKey: "AIzaSyBMClLGcUzqTewAEnt_ms82PEPhoyONjDw",
  authDomain: "meethigoleeims.firebaseapp.com",
  databaseURL: "https://meethigoleeims-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "meethigoleeims",
  storageBucket: "meethigoleeims.firebasestorage.app",
  messagingSenderId: "96726052703",
  appId: "1:96726052703:web:7356654f92164d062010ea"
};

// Initialise (compat SDK — loaded via <script> tags in index.html, no build step needed)
firebase.initializeApp(firebaseConfig);
const DB = firebase.database();

// Quick sanity check in the browser console
DB.ref(".info/connected").on("value", function (snap) {
  console.log(snap.val() ? "✅ Firebase connected" : "… connecting to Firebase");
});
