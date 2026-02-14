const express = require("express");
const path = require("path");
const sgMail = require("@sendgrid/mail");

const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Set SendGrid API key from Azure environment variable
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Test email route
app.get("/api/test-email", async (req, res) => {
  try {
    await sgMail.send({
      to: "himanshusnh63@gmail.com",   // your inbox
      from: "himanshusnh63@gmail.com", // MUST match verified sender
      subject: "✅ SendGrid test from Azure",
      text: "If you got this, the Azure → SendGrid integration works.",
    });

    res.send("Email sent successfully.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Email failed.");
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Server running on port " + port);
});
