const express = require("express");
const path = require("path");
const sgMail = require("@sendgrid/mail");

const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { BlobServiceClient } = require("@azure/storage-blob");

const app = express();

// ---------- middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ---------- Azure Blob Storage
const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.BLOB_CONTAINER_NAME || "photos";

if (!connStr) console.warn("⚠️ AZURE_STORAGE_CONNECTION_STRING is missing.");
const blobServiceClient = connStr
  ? BlobServiceClient.fromConnectionString(connStr)
  : null;

// Simple admin protection (works when App Service Authentication is enabled)
function requireAdmin(req, res, next) {
  const principal = req.headers["x-ms-client-principal"];
  if (!principal) return res.status(401).send("Unauthorized. Please sign in.");
  next();
}

// ---------- test email route
app.get("/api/test-email", async (req, res) => {
  try {
    await sgMail.send({
      to: "himanshusnh63@gmail.com",
      from: "himanshusnh63@gmail.com",
      subject: "✅ SendGrid test from Azure",
      text: "If you got this, the Azure → SendGrid integration works.",
    });

    res.send("Email sent successfully.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Email failed.");
  }
});

// ---------- interest route (2 emails)
app.post("/api/interest", async (req, res) => {
  const { firstName, lastName, email, street, city, pincode, country, photoName } = req.body;

  const adminEmail = "himanshusnh63@gmail.com";

  try {
    await sgMail.send({
      to: email,
      from: adminEmail,
      subject: "We received your interest",
      text: `Hi ${firstName},

Thanks for your interest in owning this photograph.

Photo: ${photoName || "Not specified"}

To proceed, please complete payment via Interac e-transfer to:
${adminEmail}

After payment confirmation, we’ll reply with the licensed image.

Regards,
Himanshu`,
    });

    await sgMail.send({
      to: adminEmail,
      from: adminEmail,
      subject: "New photo interest received",
      text: `New interest received:

Photo: ${photoName || "Not specified"}
Name: ${firstName} ${lastName}
Email: ${email}
Address: ${street}, ${city}, ${pincode}, ${country}`,
    });

    res.json({ message: "Submitted! Check your email for next steps." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Something failed while sending emails." });
  }
});

// ---------- NEW: list photos from blob (for homepage/gallery)
app.get("/api/photos", async (req, res) => {
  try {
    if (!blobServiceClient) return res.status(500).json({ error: "Blob not configured." });

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const photos = [];

    for await (const blob of containerClient.listBlobsFlat()) {
      photos.push({
        name: blob.name,
        url: `${containerClient.url}/${encodeURIComponent(blob.name)}`,
        lastModified: blob.properties.lastModified || null,
      });
    }

    // newest first
    photos.sort((a, b) => {
      const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return tb - ta;
    });

    res.json({ photos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list photos." });
  }
});

// ---------- NEW: upload photo to blob (admin only)
const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/upload", requireAdmin, upload.single("photo"), async (req, res) => {
  try {
    if (!blobServiceClient) return res.status(500).json({ error: "Blob not configured." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const containerClient = blobServiceClient.getContainerClient(containerName);

    const safeName = req.file.originalname.replace(/\s+/g, "-");
    const blobName = `${uuidv4()}-${safeName}`;

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });

    res.json({
      ok: true,
      name: blobName,
      url: `${containerClient.url}/${encodeURIComponent(blobName)}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed." });
  }
});

// ---------- NEW: protect admin page
app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port " + port));
