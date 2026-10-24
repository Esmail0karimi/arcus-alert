import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// EXPERIMENT BUILD: cloud sync is deliberately pointed at a dummy project so this test site can never read
// or write the real users' data. Sign-in is expected to fail here.
const firebaseConfig = {
  apiKey: "experiment-disabled",
  authDomain: "experiment-disabled.firebaseapp.com",
  projectId: "experiment-disabled",
  storageBucket: "experiment-disabled.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
