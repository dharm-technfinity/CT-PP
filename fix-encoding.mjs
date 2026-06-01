import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  'caratdesk.html',
  'caratdesk-buying.html',
  'caratdesk-selling.html',
  'caratdesk-purchase-order.html',
  'caratdesk-purchase-receipt.html',
  'caratdesk-purchase-invoice.html',
  'caratdesk-new-purchase-order.html',
  'caratdesk-new-purchase-receipt-new-25-1.html',
  'caratdesk-new-purchase-invoice.html',
  'caratdesk-new-sales-invoice.html',
  'caratdesk-sales-invoice.html',
  'caratdesk-items.html',
  'caratdesk-login.html',
  'caratdesk-purchase-receipt-entry-details.html'
];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Skipping missing: ${file}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  // Replace mojibake with correct symbols
  content = content.replace(/â‚¹/g, '₹');
  content = content.replace(/â€”/g, '—');
  content = content.replace(/â€œ/g, '"');
  content = content.replace(/â€/g, '"');
  content = content.replace(/â€™/g, "'");
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Fixed: ${file}`);
});