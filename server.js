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
app.use(express.json());

app.post("/api/interest", async (req, res) => {
  const { firstName, lastName, email, street, city, pincode, country } = req.body;

  const adminEmail = "himanshusnh63@gmail.com";

  try {
    // 1) Email to customer
    await sgMail.send({
      to: email,
      from: adminEmail,
      subject: "We received your interest",
      text:
`Hi ${firstName},

Thanks for your interest in owning this photograph.

To proceed, please complete payment via Interac e-transfer to:
${adminEmail}

After payment confirmation, we’ll reply with the licensed image.

Regards,
Himanshu`
    });

    // 2) Email to admin
    await sgMail.send({
      to: adminEmail,
      from: adminEmail,
      subject: "New photo interest received",
      text:
`New interest received:

Name: ${firstName} ${lastName}
Email: ${email}
Address: ${street}, ${city}, ${pincode}, ${country}`
    });

    res.json({ message: "Submitted! Check your email for next steps." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Something failed while sending emails." });
  }
});

app.listen(port, () => {
  console.log("Server running on port " + port);
});
