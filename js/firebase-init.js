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
    ? 'Firebase connected. Waiting for your inventory schema.'
    : 'Connecting to Firebase… Inventory will be available after schema integration.';
  if (!FIREBASE_CONNECTION_ONLY) return;
  ['login-email', 'login-passcode'].forEach(function (id) {
    const input = document.getElementById(id); if (input) input.disabled = true;
  });
  const button = document.querySelector('.btn-login-gold');
  if (button) { button.disabled = true; button.textContent = 'Awaiting your schema'; }
}
// Connection metadata only: no application data reads, writes or schema assumptions.
DB.ref('.info/connected').on('value', function (snapshot) {
  firebaseConnected = snapshot.val() === true;
  renderFirebaseConnection();
});
document.addEventListener('DOMContentLoaded', renderFirebaseConnection);
