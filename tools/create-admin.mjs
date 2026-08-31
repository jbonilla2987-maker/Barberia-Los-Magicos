import fs from "node:fs";
import process from "node:process";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";

if (!fs.existsSync(keyPath)) {
  console.error("\nFalta el archivo serviceAccountKey.json.");
  console.error("Descárgalo desde Firebase Console > Configuración del proyecto > Cuentas de servicio.");
  console.error("NO lo subas a GitHub.\n");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const username = process.argv[2] || "admin";
const password = process.argv[3];

if (!password || password.length < 8) {
  console.error('Uso: npm run bootstrap-admin -- admin "TuClaveSegura123!"');
  process.exit(1);
}

const email = `${username.toLowerCase()}@losmagicos.app`;
const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password, disabled: false });
  console.log("Cuenta administradora existente actualizada.");
} catch (e) {
  if (e.code !== "auth/user-not-found") throw e;
  user = await auth.createUser({
    email,
    password,
    displayName: "Administrador Los Mágicos",
    disabled: false
  });
  console.log("Cuenta administradora creada.");
}

await db.collection("users").doc(user.uid).set({
  role: "admin",
  name: "Administrador",
  username: username.toLowerCase(),
  emailAlias: email,
  active: true,
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true });

console.log(`\nLISTO`);
console.log(`Usuario web: ${username}`);
console.log(`Email interno: ${email}`);
console.log(`UID: ${user.uid}\n`);
