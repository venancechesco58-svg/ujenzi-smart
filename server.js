require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin'); // We use Firebase Admin now
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// 1. INITIALIZE FIREBASE
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();

// 2. SIGN UP ROUTE
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const userRecord = await auth.createUser({
            email: email,
            password: password,
            displayName: name,
        });
        res.json({ message: "Account created!", user: { name: userRecord.displayName, email: userRecord.email } });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 3. SIGN IN ROUTE
app.post('/api/signin', async (req, res) => {
    try {
        const { email } = req.body;
        const userRecord = await auth.getUserByEmail(email);
        res.json({ message: "Welcome back!", user: { name: userRecord.displayName, email: userRecord.email } });
    } catch (error) {
        res.status(401).json({ error: "User not found." });
    }
});

// 4. AI CHAT ROUTE (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(message);
        res.json({ reply: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: "AI failed" });
    }
});

app.listen(3000, () => {
    console.log(`🚀 UjenziSmart is LIVE on Firebase & Port 3000!`);
});

// 5. SNIPPE PAYMENT WEBHOOK
const db = admin.firestore();

app.post('/api/snippe-webhook', async (req, res) => {
    try {
        const paymentData = req.body;
        console.log("\n💰 Webhook Hit! Data from Snippe:", paymentData);

        const status = paymentData.status; 
        const orderId = paymentData.reference; 

        // If payment is successful, update the database
        if (status === "SUCCESS" || status === "COMPLETED" || status === "successful") {
            const orderRef = db.collection("orders").doc(orderId);
            
            const docSnap = await orderRef.get();
            if (docSnap.exists) {
                await orderRef.update({
                    status: "PROCESSING",
                    paymentStatus: "PAID",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`✅ SUCCESS: Order ${orderId} updated to PAID!`);
            } else {
                console.log(`❌ ERROR: Order ${orderId} not found in database.`);
            }
        } else {
            console.log(`⚠️ Payment Status: ${status}`);
        }

        // Always tell Snippe we received the message
        res.status(200).send("Webhook Received");
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send("Error");
    }
});