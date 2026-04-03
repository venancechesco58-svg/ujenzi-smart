const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) {
    admin.initializeApp();
}

const SNIPPE_API_KEY = "snp_9edee067665e3ce77937b54bb11aefc0f487862f74b95a05046b059dd261b6e5";
const SNIPPE_SECRET_KEY = "whsec_c30f7c5fd34fc9d492f7785c66b5261430043bc149d3df1c6afab8eb60e525c2";

// 1. THE PAYMENT CREATOR 
exports.createSnippePayment = functions.region("europe-west1").https.onCall(async (data, context) => {
    try {
        const response = await axios.post("https://api.snippe.io/v1/payments", {
            amount: data.amount,
            phone_number: data.phoneNumber,
            external_id: data.orderId,
            currency: "TZS",
            callback_url: "https://europe-west1-ujenzismart-878af.cloudfunctions.net/snippeWebhook" 
        }, {
            headers: {
                "Authorization": `Bearer ${SNIPPE_API_KEY}`,
                "X-Secret-Key": SNIPPE_SECRET_KEY
            }
        });

        return { success: true, snippeResponse: response.data };
    } catch (error) {
        console.error("Snippe Init Error:", error.response ? error.response.data : error.message);
        throw new functions.https.HttpsError("internal", "Could not start Snippe payment");
    }
});

// 2. THE AUTOMATED WEBHOOK (Now understands "COMPLETED")
exports.snippeWebhook = functions.region("europe-west1").https.onRequest(async (req, res) => {
    const paymentData = req.body;
    
    const orderId = paymentData.external_id || paymentData.order_id; 
    const paymentStatus = paymentData.status; 

    // Makes sure the text matches Snippe exactly
    const safeStatus = String(paymentStatus).toUpperCase(); 

    try {
        if (safeStatus === "SUCCESS" || safeStatus === "PAID" || safeStatus === "COMPLETED") {
            // Update the Database automatically
            await admin.firestore().collection("orders").doc(orderId).update({
                status: "PAID",
                paymentMethod: "Mobile Money (Auto)",
                paidAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ Order ${orderId} verified and PAID via Snippe.`);
            res.status(200).send("Order Updated");
        } else {
            console.log(`⚠️ Status was ${safeStatus}, ignoring.`);
            res.status(200).send("Payment Pending/Failed");
        }
    } catch (error) {
        console.error("Webhook Database Error:", error);
        res.status(500).send("Error updating order");
    }
});