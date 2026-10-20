import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA4eRekhLCoY-MtBtapmVJcln5s987Ssro",
  authDomain: "arcus-alert.firebaseapp.com",
  projectId: "arcus-alert",
  storageBucket: "arcus-alert.firebasestorage.app",
  messagingSenderId: "248498715281",
  appId: "1:248498715281:web:45fcd1ff7c3c1b827fdd30"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
