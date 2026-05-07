import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase limit for large backups
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API Route for Backup & Email
  app.post("/api/backup-email", async (req, res) => {
    const { email, zipBase64, filename } = req.body;

    if (!email || !zipBase64) {
       return res.status(400).json({ error: "Missing email or backup data" });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ 
        error: "SMTP credentials are not configured. Please set SMTP_USER and SMTP_PASS in the application settings (environment variables)." 
      });
    }

    try {
      // Setup transporter
      // Note: User needs to provide these in .env
      const transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: `"Document Vault Backup" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Full Document Backup",
        text: "Please find the attached full document backup from StudenVault.",
        attachments: [
          {
            filename: filename || "full_backup.zip",
            content: zipBase64,
            encoding: 'base64'
          },
        ],
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "Backup sent successfully to " + email });
    } catch (error: any) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email: " + error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
