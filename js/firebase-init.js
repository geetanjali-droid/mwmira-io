/* Connection only: the database schema is owned and supplied by the user.
   Do not enable the legacy adapter against this project or seed any tables. */
const FIREBASE_CONNECTION_ONLY = true;
const firebaseConfig = {
  databaseURL: "https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Realtime Database URL configuration needs no credentials from the previous project.
firebase.initializeApp(firebaseConfig);
const DB = firebase.database();
let firebaseConnected = false;
function renderFirebaseConnection() {
  const status = document.getElementById('firebase-status');
  if (status) status.textContent = firebaseConnected
    ? 'Firebase connected. You can open your dashboard.'
    : 'Connecting to Firebase… You can still open your dashboard.';
  if (!FIREBASE_CONNECTION_ONLY) return;
  ['login-email', 'login-passcode'].forEach(function (id) {
    const input = document.getElementById(id); if (input) input.hidden = true;
  });
  document.querySelectorAll('.login-field-label, .login-footnote').forEach(function (el) { el.hidden = true; });
  const subtitle = document.querySelector('.login-sub');
  if (subtitle) subtitle.textContent = 'Explore your workspace. Live inventory will appear once your data is linked.';
  const button = document.querySelector('.btn-login-gold');
  if (button) { button.disabled = false; button.textContent = 'Open dashboard'; }
}
// Connection metadata only: no application data reads, writes or schema assumptions.
DB.ref('.info/connected').on('value', function (snapshot) {
  firebaseConnected = snapshot.val() === true;
  renderFirebaseConnection();
});
document.addEventListener('DOMContentLoaded', renderFirebaseConnection);
