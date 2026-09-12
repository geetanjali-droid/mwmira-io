// Registered Firebase web configuration. Authentication is required before inventory access.
const FIREBASE_CONNECTION_ONLY = true; // The obsolete /data adapter stays blocked.
const firebaseConfig = {
  apiKey: 'AIzaSyDNyV44hLSXFK66teYSl0X27pepnIMGHA8',
  authDomain: 'mw-mira-io.firebaseapp.com',
  databaseURL: 'https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'mw-mira-io',
  appId: '1:187353423004:web:9d263fbe4ef7a7dfbce159'
};
firebase.initializeApp(firebaseConfig);
const AUTH = firebase.auth();
const DB = firebase.database();
