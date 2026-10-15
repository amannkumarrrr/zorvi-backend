import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
const user = process.env.BREVO_SMTP_USER;
const pass = process.env.BREVO_SMTP_KEY;

console.log('Testing SMTP connection with:');
console.log('Host:', host);
console.log('Port:', port);
console.log('User configured:', Boolean(user));
console.log('Pass configured:', Boolean(pass));

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false, // 587 uses STARTTLS
  auth: {
    user,
    pass,
  },
});

try {
  const result = await transporter.verify();
  console.log('SUCCESS: Nodemailer verified Brevo SMTP connection successfully!', result);
} catch (error) {
  console.error('ERROR verifying SMTP connection:', error.message);
  if (error.response) console.error('Response:', error.response);
  if (error.responseCode) console.error('Response code:', error.responseCode);
}
