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

// Prefer this env var name (clear + consistent)
const containerName =
  process.env.AZURE_STORAGE_CONTAINER_NAME ||
  process.env.BLOB_CONTAINER_NAME ||
  "photos";

if (!connStr) console.warn("⚠️ AZURE_STORAGE_CONNECTION_STRING is missing.");

const blobServiceClient = connStr
  ? BlobServiceClient.fromConnectionString(connStr)
  : null;

// ---------- Admin allowlist (ONLY these signed-in users can upload)
// Put your own email here (or use an env var if you want)
const ADMIN_EMAILS = new Set([
  "himanshusnh63@gmail.com",
  // add more if needed
]);

// ---------- Helpers: decode App Service Authentication principal
function getClientPrincipal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;

  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

function getEmailFromPrincipal(principal) {
  if (!principal) return null;

  // Many times email is in claims
  const claims = principal.claims || [];
  const emailClaim =
    claims.find((c) => c.typ === "emails") ||
    claims.find((c) => c.typ === "email") ||
    claims.find((c) => c.typ === "preferred_username") ||
    claims.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress");

  return emailClaim?.val || null;
}

// Redirect to login if not signed-in (this triggers the sign-in prompt)
function requireSignIn(req, res, next) {
  const principal = getClientPrincipal(req);

  if (!principal) {
    // Redirect to App Service Authentication login
    // Works when Authentication is enabled on the Web App
    return res.redirect("/.auth/login/aad?post_login_redirect_url=" + encodeURIComponent(req.originalUrl));
  }

  next();
}

// Allow only specific admin emails
function requireAdmin(req, res, next) {
  const principal = getClientPrincipal(req);

  if (!principal) {
    return res.redirect("/.auth/login/aad?post_login_redirect_url=" + encodeURIComponent(req.originalUrl));
  }

  const email = getEmailFromPrincipal(principal);

  if (!email || !ADMIN_EMAILS.has(email.toLowerCase())) {
    return res.status(403).send("Forbidden. You are signed in but not an admin.");
  }

  // Optional: attach for debugging
  req.adminEmail = email;
  next();
}

// ---------- Debug endpoint (optional but super useful)
app.get("/api/me", (req, res) => {
  const principal = getClientPrincipal(req);
  res.json({
    signedIn: !!principal,
    email: getEmailFromPrincipal(principal),
    principal,
  });
});

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
    console.error(error?.response?.body || error);
    res.status(500).send("Email failed.");
  }
});

// ---------- interest route (2 emails)
app.post("/api/interest", async (req, res) => {
  const { firstName, lastName, email, street, city, pincode, country, photoName } = req.body;

  const adminEmail = "himanshusnh63@gmail.com";

  try {
    // 1) Email to customer
    await sgMail.send({
      to: email,
      from: adminEmail,
      subject: "We received your interest",
      text: `Hi ${firstName},

Thanks for your interest in owning this photograph.

Photo: ${photoName || "Not specified"}

To proceed, please complete payment via Interac e-transfer to:
${adminEmail}
Please transfer $10 through interac on the email .
After payment confirmation, we’ll reply with the licensed image.

Regards,
Himanshu`,
    });

    // 2) Email to admin
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
    console.error(err?.response?.body || err);
    res.status(500).json({ message: "Something failed while sending emails." });
  }
});

// ---------- list photos from blob (for homepage/gallery)
app.get("/api/photos", async (req, res) => {
  try {
    if (!blobServiceClient) return res.status(500).json({ error: "Blob not configured." });

    const containerClient = blobServiceClient.getContainerClient(containerName);

    const photos = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      const name = blob.name;

      // only images
      if (!name.match(/\.(jpg|jpeg|png|webp|gif)$/i)) continue;

      // Use SDK to get correct URL (handles encoding safely)
      const blobClient = containerClient.getBlobClient(name);

      photos.push({
        name,
        url: blobClient.url,
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

// ---------- upload photo to blob (admin only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

app.post("/api/upload", requireAdmin, upload.single("photo"), async (req, res) => {
  try {
    if (!blobServiceClient) return res.status(500).json({ error: "Blob not configured." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Put everything into a folder (optional but recommended)
    // Example: cities/<uuid>-filename.jpg
    const category = (req.body.category || "cities").toLowerCase().replace(/[^a-z0-9-_]/g, "");
    const safeName = req.file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
    const blobName = `${category}/${uuidv4()}-${safeName}`;

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });

    res.json({
      ok: true,
      uploadedBy: req.adminEmail,
      name: blobName,
      url: blockBlobClient.url,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed." });
  }
});

// ---------- protect admin page (forces sign-in)
app.get("/admin.html", requireSignIn, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port " + port));
